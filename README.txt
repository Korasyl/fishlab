ARCA FISH LAB - the phone app (an installable web app), v0.15.0

What this folder is
  The whole Fish Lab as a web app that a phone can install to its home screen and use with no connection.
  It has to be opened from a web address that starts with https:// - a phone will not install it from a file.

How it becomes an app
  1. Put this folder's contents on any https web host (GitHub Pages is free).
  2. Android: open the address in Chrome, then menu > "Add to Home screen" / "Install app".
  3. iPhone: open the address in Safari, then Share > "Add to Home Screen".
  For a real Android .apk file: give the address to https://www.pwabuilder.com and choose Android.

Files
  index.html, app.js, fishcore.js   the app
  manifest.webmanifest, *.png       its name, colours and icons (all files sit side by side: no folders)
  sw.js                             keeps a copy on the phone so it opens offline. When the app changes,
                                    change VERSION at the top of sw.js so phones fetch the new one.
