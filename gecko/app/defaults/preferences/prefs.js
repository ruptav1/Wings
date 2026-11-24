// Unknow Web Browser on Mozilla's Gecko core: its own window, and the engine set up as a browser.
// (Settings the user changes in the interface are applied by Backend.sys.mjs: applyPrefs.)
pref("toolkit.defaultChromeURI", "chrome://unknowweb/content/ui/index.html");
pref("toolkit.defaultChromeFeatures", "chrome,dialog=no,all,resizable");
pref("browser.chromeURL", "chrome://unknowweb/content/ui/index.html");
pref("browser.dom.window.dump.enabled", true);
pref("devtools.console.stdout.chrome", true);
pref("devtools.console.stdout.content", false);
pref("general.useragent.locale", "vi");
pref("intl.locale.requested", "vi");

// pages in processes of their own, one per site
pref("browser.tabs.remote.autostart", true);
pref("fission.autostart", true);
pref("dom.ipc.processCount", 4);
pref("dom.ipc.processPrelaunch.enabled", false);
pref("dom.ipc.keepProcessesAlive.web", 1);

// pages that open windows: a new tab (sign-in popups included)
pref("browser.link.open_newwindow", 3);
pref("browser.link.open_newwindow.restriction", 0);
pref("browser.link.open_newwindow.override.external", 3);
pref("dom.disable_open_during_load", true);
pref("dom.popup_allowed_events", "change click dblclick auxclick mousedown mouseup pointerdown pointerup notificationclick reset submit touchend contextmenu");

// downloads straight to the folder, listed in the interface (Tải xuống)
pref("browser.download.useDownloadDir", true);
pref("browser.download.folderList", 2);
pref("browser.download.always_ask_before_handling_new_types", false);
pref("browser.download.start_downloads_in_tmp_dir", false);
pref("browser.download.manager.addToRecentDocs", false);
pref("browser.download.open_pdf_attachments_inline", true);
pref("browser.download.alwaysOpenPanel", false);
pref("browser.download.panel.shown", true);
pref("browser.helperApps.showOpenOptionForPdfJS", false);
pref("pdfjs.disabled", false);

// the pages: as in a browser
pref("general.autoScroll", true);
pref("general.smoothScroll", true);
pref("layout.spellcheckDefault", 1);
pref("ui.key.menuAccessKeyFocuses", false);
pref("media.autoplay.default", 0);
pref("media.videocontrols.picture-in-picture.enabled", true);
pref("media.videocontrols.picture-in-picture.video-toggle.enabled", true);
pref("full-screen-api.enabled", true);
pref("full-screen-api.transition-duration.enter", "0 0");
pref("full-screen-api.transition-duration.leave", "0 0");
pref("full-screen-api.warning.timeout", 0);
pref("print.prefer_system_dialog", true);
pref("print.always_print_silent", false);
pref("places.history.enabled", false);
pref("browser.formfill.enable", true);
pref("signon.rememberSignons", false);
pref("dom.security.https_first", true);
pref("network.cookie.cookieBehavior", 1);
pref("privacy.donottrackheader.enabled", true);
pref("privacy.globalprivacycontrol.enabled", true);
pref("privacy.globalprivacycontrol.functionality.enabled", true);
pref("privacy.trackingprotection.enabled", false);
pref("privacy.trackingprotection.pbmode.enabled", false);
pref("browser.safebrowsing.malware.enabled", false);
pref("browser.safebrowsing.phishing.enabled", false);
pref("browser.safebrowsing.downloads.enabled", false);
pref("browser.safebrowsing.downloads.remote.enabled", false);
pref("browser.safebrowsing.provider.mozilla.updateURL", "");
pref("browser.safebrowsing.provider.google4.updateURL", "");
pref("browser.safebrowsing.provider.google.updateURL", "");

// nothing sent to Mozilla, nothing updated behind the user's back
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.archive.enabled", false);
pref("toolkit.telemetry.server", "");
pref("app.update.enabled", false);
pref("app.update.auto", false);
pref("app.normandy.enabled", false);
pref("app.shield.optoutstudies.enabled", false);
pref("extensions.update.enabled", false);
pref("extensions.getAddons.cache.enabled", false);
pref("extensions.systemAddon.update.enabled", false);
pref("network.captive-portal-service.enabled", false);
pref("network.connectivity-service.enabled", false);
pref("services.settings.server", "");
pref("browser.region.network.url", "");
pref("browser.region.update.enabled", false);
pref("geo.provider.network.url", "");
pref("network.trr.mode", 0);
pref("security.OCSP.enabled", 1);
pref("dom.push.connection.enabled", false);
pref("dom.push.serverURL", "");
pref("captivedetect.canonicalURL", "");
pref("toolkit.crashreporter.enabled", false);
pref("browser.crashReports.unsubmittedCheck.enabled", false);
pref("gfx.webrender.all", true);

// (the engine's early blank window and its registry entries: not used)
pref("browser.startup.preXulSkeletonUI", false);

// (a wallpaper's music plays from an unseen player)
pref("media.block-autoplay-until-in-foreground", false);
