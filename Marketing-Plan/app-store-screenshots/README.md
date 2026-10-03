# App Store screenshots (iPhone 6.9", 1320x2868)

- `source/screenshots.html` is the single source for every slide and both languages. `?lang=en|fr&n=1..10`.
- `en/` holds the 10 English PNGs. `fr/` holds the 10 French PNGs.
- Render (Chrome headless): `chrome --headless=new --hide-scrollbars --force-device-scale-factor=1 --window-size=1320,2868 --screenshot=out.png "file:///.../screenshots.html?lang=en&n=1"`
- Upload in filename order (01 to 10) to App Store Connect, iPhone 6.9" slot. Apple scales it to smaller iPhones.
- Mock data is invented. Screens are illustrative, not captures. No Costco logo, no free-period wording, no guaranteed-refund claims.
- Slide 10 carries the "independent app, not affiliated with Costco" line.
