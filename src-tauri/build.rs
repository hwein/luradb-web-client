fn main() {
  // tauri-build only tracks tauri.conf.json/capabilities; without this line an icon swap stays invisible in the EXE
  println!("cargo:rerun-if-changed=icons");
  tauri_build::build()
}
