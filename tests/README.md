# APEX test suite

```bash
pip install playwright && playwright install chromium
cd src && python3 -m http.server 8777 &
python3 tests/suite.py
```

121 assertions in headless Chromium, timezone `Asia/Kolkata` so local-vs-UTC
date bugs surface. Results and the list of what is **not** covered are in
`docs/TEST-REPORT-5.1.md`.
