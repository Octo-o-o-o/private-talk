#import <UIKit/UIKit.h>
#import <objc/runtime.h>

/*
 * Status bar style bridge.
 *
 * iOS 13+ doesn't have a writable global status-bar style anymore —
 * `UIApplication.setStatusBarStyle:` is deprecated and a no-op when
 * the app uses view-controller-based appearance (which is the default,
 * and which we keep so the system handles all the safe-area / large
 * title machinery). The clean replacement is overriding
 * `preferredStatusBarStyle` on the window's root view controller and
 * calling `setNeedsStatusBarAppearanceUpdate`.
 *
 * Tauri owns the root VC (it's an internal subclass we don't have a
 * Swift handle to). Rather than swizzle every UIViewController in the
 * runtime — which would also flip modally-presented system sheets —
 * we look up the actual root class on first call, install a
 * `preferredStatusBarStyle` IMP on *that* class only, and key its
 * return value off a static we can flip from Rust. This leaves every
 * other VC unaffected.
 *
 * Style values match the JS contract:
 *   0 = .default (system picks; same as no override)
 *   1 = .lightContent (white glyphs, for dark backgrounds)
 *   2 = .darkContent  (black glyphs, for light backgrounds; iOS 13+)
 */

static UIStatusBarStyle pt_current_status_bar_style = UIStatusBarStyleDefault;
static Class pt_root_vc_class = Nil;
static BOOL pt_root_vc_installed = NO;

static UIStatusBarStyle pt_preferred_status_bar_style_impl(id self, SEL _cmd) {
    (void)self;
    (void)_cmd;
    return pt_current_status_bar_style;
}

static UIWindow *pt_find_key_window(void) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:[UIWindowScene class]]) {
            continue;
        }
        UIWindowScene *windowScene = (UIWindowScene *)scene;
        for (UIWindow *window in windowScene.windows) {
            if (window.isKeyWindow) {
                return window;
            }
        }
    }
    // Fall back to whatever window the first windowScene has if none is key
    // yet (early launch).
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:[UIWindowScene class]]) {
            continue;
        }
        UIWindow *window = ((UIWindowScene *)scene).windows.firstObject;
        if (window) return window;
    }
    return nil;
}

static void pt_install_root_vc_override(UIViewController *vc) {
    if (pt_root_vc_installed || vc == nil) {
        return;
    }
    pt_root_vc_class = [vc class];
    SEL sel = @selector(preferredStatusBarStyle);
    // Use class_addMethod first — succeeds if the root VC hasn't already
    // overridden the getter (the common case for Tauri's internal VC).
    if (!class_addMethod(pt_root_vc_class,
                         sel,
                         (IMP)pt_preferred_status_bar_style_impl,
                         "i@:")) {
        // Already has its own; replace its implementation. This still
        // only touches the one class — sibling VCs (modal sheets etc.)
        // keep their behaviour.
        Method existing = class_getInstanceMethod(pt_root_vc_class, sel);
        if (existing != NULL) {
            method_setImplementation(existing,
                                     (IMP)pt_preferred_status_bar_style_impl);
        }
    }
    pt_root_vc_installed = YES;
}

__attribute__((visibility("default")))
void pt_status_bar_set_style(int style) {
    UIStatusBarStyle resolved;
    switch (style) {
        case 1:  resolved = UIStatusBarStyleLightContent; break;
        case 2:  resolved = UIStatusBarStyleDarkContent; break;
        default: resolved = UIStatusBarStyleDefault; break;
    }

    dispatch_async(dispatch_get_main_queue(), ^{
        pt_current_status_bar_style = resolved;
        UIWindow *window = pt_find_key_window();
        UIViewController *root = window.rootViewController;
        pt_install_root_vc_override(root);
        [root setNeedsStatusBarAppearanceUpdate];
    });
}
