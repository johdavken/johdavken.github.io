package tools.resin.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

public class UpdateReleaseTest {

    private static final String PKG = "tools.resin.app.slatepreview";
    private static final String BASE = "https://github.com/johdavken/johdavken.github.io/releases/download/v1.1.27/";

    private static String[] asset(String name) {
        return new String[] { name, BASE + name };
    }

    @Test
    public void offersANewerApkForThisPackage() {
        List<String[]> assets = Collections.singletonList(asset(PKG + "-10127.apk"));
        UpdateRelease.Candidate c = UpdateRelease.pick(PKG, 37, "v1.1.27", assets);
        assertEquals(10127, c.versionCode);
        assertEquals("1.1.27", c.versionName);
        assertEquals(BASE + PKG + "-10127.apk", c.downloadUrl);
    }

    @Test
    public void ignoresTheSameOrAnOlderVersion() {
        List<String[]> assets = Collections.singletonList(asset(PKG + "-10127.apk"));
        assertNull(UpdateRelease.pick(PKG, 10127, "v1.1.27", assets));
        assertNull(UpdateRelease.pick(PKG, 10200, "v1.1.27", assets));
    }

    @Test
    public void neverOffersAnotherPackagesApk() {
        List<String[]> assets = Arrays.asList(asset("tools.resin.app-10127.apk"), asset("tools.resin.app.slatepreview.extra-10127.apk"));
        assertNull(UpdateRelease.pick(PKG, 37, "v1.1.27", assets));
        assertNull(UpdateRelease.pick("tools.resin.app", 37, "v1.1.27", Collections.singletonList(asset(PKG + "-10127.apk"))));
    }

    @Test
    public void picksThisPackageOutOfSeveral() {
        List<String[]> assets = Arrays.asList(asset("tools.resin.app-10127.apk"), asset(PKG + "-10127.apk"), asset("notes.txt"));
        assertEquals(BASE + PKG + "-10127.apk", UpdateRelease.pick(PKG, 37, "v1.1.27", assets).downloadUrl);
    }

    @Test
    public void rejectsMalformedTagsNamesAndUrls() {
        List<String[]> ok = Collections.singletonList(asset(PKG + "-10127.apk"));
        assertNull(UpdateRelease.pick(PKG, 37, "1.1.27", ok));
        assertNull(UpdateRelease.pick(PKG, 37, "v1.1.27a", ok));
        assertNull(UpdateRelease.pick(PKG, 37, "v1.1.27", Collections.singletonList(asset(PKG + "-latest.apk"))));
        assertNull(UpdateRelease.pick(PKG, 37, "v1.1.27", Collections.singletonList(new String[] { PKG + "-10127.apk", "http://example.com/x.apk" })));
        assertNull(UpdateRelease.pick(PKG, 37, "v1.1.27", Arrays.asList(null, new String[] { null, null }, new String[] { "x" })));
        assertNull(UpdateRelease.pick(null, 37, "v1.1.27", ok));
        assertNull(UpdateRelease.pick(PKG, 37, null, ok));
    }
}
