package tools.resin.app;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure decision half of the GitHub-release updater: given the assets of the
 * repository's latest release, is there an APK for THIS package that is newer
 * than what is installed? No Android or network types, so it is unit-tested
 * on the JVM (UpdateReleaseTest); AppUpdater does the I/O around it.
 *
 * The release workflow names every APK "<applicationId>-<versionCode>.apk",
 * so the asset name alone says which package it is and how new it is. A
 * release can therefore carry several packages side by side, and a build of a
 * different package (tools.resin.app vs tools.resin.app.slatepreview) never
 * offers to install an APK that would land beside it instead of over it.
 */
public final class UpdateRelease {

    private static final Pattern ASSET = Pattern.compile("^(.+)-(\\d{1,9})\\.apk$");
    private static final Pattern TAG = Pattern.compile("^v(\\d+\\.\\d+\\.\\d+)$");

    private UpdateRelease() {}

    /** A newer APK for this package. */
    public static final class Candidate {
        public final int versionCode;
        public final String versionName;
        public final String assetName;
        public final String downloadUrl;

        Candidate(int versionCode, String versionName, String assetName, String downloadUrl) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.assetName = assetName;
            this.downloadUrl = downloadUrl;
        }
    }

    /**
     * @param packageName       the running app's package (getPackageName())
     * @param installedCode     the running app's versionCode
     * @param tag               the release's tag_name, e.g. "v1.1.27"
     * @param assets            each asset as {name, browser_download_url}
     * @return the newest matching APK above installedCode, or null
     */
    public static Candidate pick(String packageName, long installedCode, String tag, List<String[]> assets) {
        if (packageName == null || packageName.isEmpty() || tag == null || assets == null) return null;
        Matcher tagMatch = TAG.matcher(tag);
        if (!tagMatch.matches()) return null;
        String versionName = tagMatch.group(1);

        Candidate best = null;
        for (String[] asset : assets) {
            if (asset == null || asset.length < 2 || asset[0] == null || asset[1] == null) continue;
            Matcher m = ASSET.matcher(asset[0]);
            if (!m.matches() || !packageName.equals(m.group(1))) continue;
            if (!asset[1].startsWith("https://")) continue;
            int code = Integer.parseInt(m.group(2));
            if (code <= installedCode) continue;
            if (best == null || code > best.versionCode) {
                best = new Candidate(code, versionName, asset[0], asset[1]);
            }
        }
        return best;
    }
}
