fn main() {
  // tauri-build trackt nur tauri.conf.json/capabilities — ohne diese Zeile bleibt ein Icon-Tausch in der EXE unsichtbar
  println!("cargo:rerun-if-changed=icons");
  tauri_build::build()
}
