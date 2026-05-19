fn main() {
    // On iOS the final app binary is linked by Xcode, which pulls in our
    // ObjC bridge files (gen/apple/Sources/private-talk/*.m) from the
    // Xcode project's Sources build phase. Cargo only ever produces the
    // staticlib for that final link, but the way our Cargo.toml is set
    // up (`crate-type = ["staticlib", "cdylib", "rlib"]`) means cargo
    // also tries to ship a cdylib, which requires every extern "C"
    // symbol — including the ones that live in the .m files — to be
    // resolvable at cargo-link time. They aren't yet, so we tell the
    // dynamic linker to defer them to load time; Xcode then resolves
    // them when it links the app. This is the same pattern Tauri's own
    // mobile templates ship.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "ios" {
        println!("cargo:rustc-cdylib-link-arg=-Wl,-undefined,dynamic_lookup");
    }

    tauri_build::build()
}
