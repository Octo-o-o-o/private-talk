#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

// Fix two iOS WKWebView issues:
// 1. Remove the keyboard input accessory bar (∧ ∨ ✓)
// 2. Set the WKWebView background to prevent blue splash color bleeding through

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

            // 2. Find the WKWebView and clear its background color
            // so the web page CSS background shows instead of the native bg
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
                [self clearWebViewBackground:keyWindow];
            }

            [[NSNotificationCenter defaultCenter] removeObserver:observer];
        }];
}

+ (void)clearWebViewBackground:(UIView *)view {
    if ([view isKindOfClass:[WKWebView class]]) {
        WKWebView *webView = (WKWebView *)view;
        webView.backgroundColor = UIColor.clearColor;
        webView.scrollView.backgroundColor = UIColor.clearColor;
        webView.opaque = NO;
        return;
    }
    for (UIView *subview in view.subviews) {
        [self clearWebViewBackground:subview];
    }
}

@end
