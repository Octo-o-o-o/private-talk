#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

// Fix two iOS WKWebView issues:
// 1. Remove the keyboard input accessory bar (∧ ∨ ✓)
// 2. Give the native host / WKWebView a system background fallback so rounded
//    keyboard corners never expose a black or splash-colored backing view.

@implementation UIView (PrivateTalkWebViewFixes)

+ (void)load {
    // WKContentView is not yet loaded at +load time, so we defer until
    // the app is fully active (WKWebView is guaranteed to exist by then).
    static id observer = nil;
    observer = [[NSNotificationCenter defaultCenter]
        addObserverForName:UIApplicationDidBecomeActiveNotification
        object:nil
        queue:[NSOperationQueue mainQueue]
        usingBlock:^(NSNotification *note) {
            // 1. Remove input accessory view on WKContentView
            Class wkContentView = NSClassFromString(@"WKContentView");
            if (wkContentView) {
                SEL sel = @selector(inputAccessoryView);
                IMP nilImpl = imp_implementationWithBlock(^(id _self) {
                    return (UIView *)nil;
                });
                Method m = class_getInstanceMethod(wkContentView, sel);
                if (m) {
                    method_setImplementation(m, nilImpl);
                } else {
                    class_addMethod(wkContentView, sel, nilImpl, "@@:");
                }
            }

            // 2. Find the WKWebView and give the native host a theme-aware
            // background fallback behind the web content.
            UIWindow *keyWindow = nil;
            for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
                if ([scene isKindOfClass:[UIWindowScene class]]) {
                    for (UIWindow *w in ((UIWindowScene *)scene).windows) {
                        if (w.isKeyWindow) { keyWindow = w; break; }
                    }
                }
                if (keyWindow) break;
            }
            if (keyWindow) {
                keyWindow.backgroundColor = UIColor.systemBackgroundColor;
                keyWindow.rootViewController.view.backgroundColor = UIColor.systemBackgroundColor;
                [self clearWebViewBackground:keyWindow];
            }

            [[NSNotificationCenter defaultCenter] removeObserver:observer];
        }];
}

+ (void)clearWebViewBackground:(UIView *)view {
    if ([view isKindOfClass:[WKWebView class]]) {
        WKWebView *webView = (WKWebView *)view;
        webView.backgroundColor = UIColor.systemBackgroundColor;
        webView.scrollView.backgroundColor = UIColor.systemBackgroundColor;
        webView.opaque = NO;
        return;
    }
    for (UIView *subview in view.subviews) {
        [self clearWebViewBackground:subview];
    }
}

@end
