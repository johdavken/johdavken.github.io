package tools.resin.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import androidx.appcompat.app.AlertDialog;
import androidx.core.content.FileProvider;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Self-update from the repository's GitHub Releases - the APK is served by
 * git, not a store. On resume (at most every few hours, and once per cold
 * start) it reads releases/latest, asks UpdateRelease whether an APK for this
 * package is newer than the installed one, and if so offers to install it.
 *
 * Android does the real safety work: the system installer refuses an APK
 * signed with a different key or carrying a lower versionCode, and the user
 * always confirms on Android's own install screen. On top of that the
 * download is checked to be this package at the announced versionCode before
 * the installer is opened at all.
 *
 * Native only, by design: the web app (every view - legacy, Slate, Station)
 * knows nothing about it, and nothing here touches operator state. A failed
 * check or download is silent or a short message; the app keeps running.
 */
final class AppUpdater {

    static final String LATEST_RELEASE_URL =
        "https://api.github.com/repos/johdavken/johdavken.github.io/releases/latest";

    private static final long CHECK_INTERVAL_MS = 6L * 60 * 60 * 1000;
    private static final long MAX_APK_BYTES = 200L * 1024 * 1024;
    private static final int MAX_JSON_BYTES = 2 * 1024 * 1024;
    private static final String PREFS = "resin_app_updater";
    private static final String KEY_LAST_CHECK = "lastCheckAt";
    private static final String DOWNLOAD_DIR = "updates";

    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static boolean checkedThisProcess;
    private static boolean busy;
    private static UpdateRelease.Candidate pendingAfterPermission;

    private AppUpdater() {}

    /** Call from MainActivity.onResume. */
    static void onResume(Activity activity) {
        if (pendingAfterPermission != null) {
            // Back from Android's "install unknown apps" screen. Allowed: carry
            // on with the Install the user already tapped. Not allowed: drop it,
            // so a later grant by some other route never starts a download
            // without a fresh tap.
            if (!canInstall(activity)) {
                pendingAfterPermission = null;
            } else if (!busy) {
                UpdateRelease.Candidate candidate = pendingAfterPermission;
                pendingAfterPermission = null;
                download(activity, candidate);
                return;
            }
        }
        if (busy) return;
        SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        long last = prefs.getLong(KEY_LAST_CHECK, 0);
        if (checkedThisProcess && now - last < CHECK_INTERVAL_MS && now >= last) return;
        checkedThisProcess = true;
        busy = true;

        final Context app = activity.getApplicationContext();
        final WeakReference<Activity> ref = new WeakReference<>(activity);
        IO.execute(() -> {
            UpdateRelease.Candidate candidate = null;
            try {
                deleteOldDownloads(app);
                candidate = fetchCandidate(app);
                prefs.edit().putLong(KEY_LAST_CHECK, System.currentTimeMillis()).apply();
            } catch (Exception ignored) {
                // Offline, rate-limited or GitHub down: try again on a later resume.
            }
            final UpdateRelease.Candidate found = candidate;
            MAIN.post(() -> {
                busy = false;
                Activity a = ref.get();
                if (found != null && alive(a)) offer(a, found);
            });
        });
    }

    private static UpdateRelease.Candidate fetchCandidate(Context context) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(LATEST_RELEASE_URL).openConnection();
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(15000);
        conn.setRequestProperty("Accept", "application/vnd.github+json");
        conn.setRequestProperty("User-Agent", "ResinTools-Updater");
        try {
            if (conn.getResponseCode() != 200) return null;
            String body;
            try (InputStream in = conn.getInputStream()) {
                body = readLimited(in, MAX_JSON_BYTES);
            }
            JSONObject release = new JSONObject(body);
            if (release.optBoolean("draft") || release.optBoolean("prerelease")) return null;
            JSONArray rawAssets = release.optJSONArray("assets");
            List<String[]> assets = new ArrayList<>();
            if (rawAssets != null) {
                for (int i = 0; i < rawAssets.length(); i++) {
                    JSONObject asset = rawAssets.optJSONObject(i);
                    if (asset == null) continue;
                    assets.add(new String[] { asset.optString("name", null), asset.optString("browser_download_url", null) });
                }
            }
            return UpdateRelease.pick(context.getPackageName(), installedVersionCode(context), release.optString("tag_name", null), assets);
        } finally {
            conn.disconnect();
        }
    }

    private static void offer(Activity activity, UpdateRelease.Candidate candidate) {
        String label = appLabel(activity);
        new AlertDialog.Builder(activity)
            .setTitle("Update available")
            .setMessage(label + " " + candidate.versionName + " is ready to install. This phone has "
                + installedVersionName(activity) + ".\n\nYour line, workspace and settings stay as they are.")
            .setPositiveButton("Install", (d, w) -> startInstall(activity, candidate))
            .setNegativeButton("Later", null)
            .show();
    }

    private static void startInstall(Activity activity, UpdateRelease.Candidate candidate) {
        if (canInstall(activity)) {
            download(activity, candidate);
            return;
        }
        // Android 8+: the user allows this app as an install source once.
        new AlertDialog.Builder(activity)
            .setTitle("Allow updates")
            .setMessage("Android needs your OK once before " + appLabel(activity)
                + " can install its own updates. Turn on \"Allow from this source\", then come back.")
            .setPositiveButton("Open settings", (d, w) -> {
                pendingAfterPermission = candidate;
                try {
                    activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName())));
                } catch (Exception e) {
                    pendingAfterPermission = null;
                    failed(activity, "Couldn't open Android's settings.");
                }
            })
            .setNegativeButton("Later", null)
            .show();
    }

    private static void download(Activity activity, UpdateRelease.Candidate candidate) {
        if (busy) return;
        busy = true;
        final ProgressBar bar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        bar.setIndeterminate(true);
        LinearLayout box = new LinearLayout(activity);
        int pad = Math.round(24 * activity.getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 2, pad, 0);
        box.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        final boolean[] cancelled = { false };
        final AlertDialog dialog = new AlertDialog.Builder(activity)
            .setTitle("Downloading " + candidate.versionName)
            .setView(box)
            .setCancelable(false)
            .setNegativeButton("Cancel", (d, w) -> cancelled[0] = true)
            .show();

        final Context app = activity.getApplicationContext();
        final WeakReference<Activity> ref = new WeakReference<>(activity);
        IO.execute(() -> {
            File apk = null;
            String error = null;
            try {
                apk = fetchApk(app, candidate, cancelled, (done, total) -> MAIN.post(() -> {
                    if (total > 0) {
                        bar.setIndeterminate(false);
                        bar.setMax(1000);
                        bar.setProgress((int) (done * 1000 / total));
                    }
                }));
                if (apk != null && !isExpectedApk(app, apk, candidate)) {
                    apk.delete();
                    apk = null;
                    error = "The downloaded update didn't match this app, so it wasn't installed.";
                }
            } catch (Exception e) {
                apk = null;
                error = "Couldn't download the update. Try again later.";
            }
            final File ready = apk;
            final String message = error;
            MAIN.post(() -> {
                busy = false;
                Activity a = ref.get();
                if (dialog.isShowing() && alive(a)) dialog.dismiss();
                if (cancelled[0] || !alive(a)) return;
                if (ready != null) openInstaller(a, ready);
                else if (message != null) failed(a, message);
            });
        });
    }

    private interface Progress {
        void update(long done, long total);
    }

    private static File fetchApk(Context context, UpdateRelease.Candidate candidate, boolean[] cancelled, Progress progress) throws IOException {
        File dir = new File(context.getCacheDir(), DOWNLOAD_DIR);
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("no download dir");
        File part = new File(dir, candidate.assetName + ".part");
        File apk = new File(dir, candidate.assetName);

        // Release assets redirect (github.com -> objects.githubusercontent.com);
        // HttpURLConnection follows HTTPS -> HTTPS redirects on its own.
        HttpURLConnection conn = (HttpURLConnection) new URL(candidate.downloadUrl).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setRequestProperty("User-Agent", "ResinTools-Updater");
        try {
            if (conn.getResponseCode() != 200) throw new IOException("HTTP " + conn.getResponseCode());
            long total = conn.getContentLengthLong();
            if (total > MAX_APK_BYTES) throw new IOException("too large");
            long done = 0;
            byte[] buffer = new byte[64 * 1024];
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                int n;
                while ((n = in.read(buffer)) != -1) {
                    if (cancelled[0]) {
                        part.delete();
                        return null;
                    }
                    done += n;
                    if (done > MAX_APK_BYTES) throw new IOException("too large");
                    out.write(buffer, 0, n);
                    progress.update(done, total);
                }
            }
            if (total > 0 && done != total) throw new IOException("short download");
            if (apk.exists()) apk.delete();
            if (!part.renameTo(apk)) throw new IOException("rename failed");
            return apk;
        } catch (IOException e) {
            part.delete();
            throw e;
        } finally {
            conn.disconnect();
        }
    }

    private static boolean isExpectedApk(Context context, File apk, UpdateRelease.Candidate candidate) {
        PackageInfo info = context.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        if (info == null || !context.getPackageName().equals(info.packageName)) return false;
        return versionCodeOf(info) == candidate.versionCode;
    }

    private static void openInstaller(Activity activity, File apk) {
        try {
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(intent);
        } catch (Exception e) {
            failed(activity, "Couldn't open Android's installer.");
        }
    }

    private static void failed(Activity activity, String message) {
        new AlertDialog.Builder(activity)
            .setTitle("Update not installed")
            .setMessage(message)
            .setPositiveButton("OK", null)
            .show();
    }

    private static boolean canInstall(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return context.getPackageManager().canRequestPackageInstalls();
    }

    private static boolean alive(Activity activity) {
        return activity != null && !activity.isFinishing() && !activity.isDestroyed();
    }

    private static void deleteOldDownloads(Context context) {
        File[] files = new File(context.getCacheDir(), DOWNLOAD_DIR).listFiles();
        if (files == null) return;
        for (File f : files) f.delete();
    }

    private static String readLimited(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int n;
        while ((n = in.read(buffer)) != -1) {
            if (out.size() + n > limit) throw new IOException("response too large");
            out.write(buffer, 0, n);
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private static PackageInfo selfInfo(Context context) throws PackageManager.NameNotFoundException {
        return context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
    }

    @SuppressWarnings("deprecation")
    private static long versionCodeOf(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
    }

    private static long installedVersionCode(Context context) throws PackageManager.NameNotFoundException {
        return versionCodeOf(selfInfo(context));
    }

    private static String installedVersionName(Context context) {
        try {
            String name = selfInfo(context).versionName;
            return name != null ? name : "an older version";
        } catch (PackageManager.NameNotFoundException e) {
            return "an older version";
        }
    }

    private static String appLabel(Context context) {
        return String.valueOf(context.getApplicationInfo().loadLabel(context.getPackageManager()));
    }
}
