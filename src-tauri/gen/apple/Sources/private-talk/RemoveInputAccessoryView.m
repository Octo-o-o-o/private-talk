#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

// Fix three iOS WKWebView issues:
// 1. Remove the keyboard input accessory bar (< > Done)
// 2. Force the WKWebView to extend edge-to-edge (behind safe areas)
// 3. Match native background to splash colour during launch, then
//    transition to system background after the web splash fades.

// Splash blue matching LaunchScreen.storyboard / index.html (#35A6FD).
static UIColor *_splashBlue(void) {
    return [UIColor colorWithRed:0x35/255.0 green:0xA6/255.0 blue:0xFD/255.0 alpha:1.0];
}

@implementation UIView (PrivateTalkWebViewFixes)

+ (void)load {
    // WKContentView is not yet loaded at +load time, so defer until
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

            // 2-3. Find key window, force edge-to-edge, set backgrounds.
            UIColor *splashColor = _splashBlue();
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
                UIViewController *rootVC = keyWindow.rootViewController;
                UIView *hostView = rootVC.view ?: keyWindow;
                if (rootVC) {
                    rootVC.additionalSafeAreaInsets = UIEdgeInsetsZero;
                    rootVC.edgesForExtendedLayout = UIRectEdgeAll;
                    rootVC.extendedLayoutIncludesOpaqueBars = YES;
                }

                [self prepareContainerView:hostView];

                // Walk the hierarchy and pin both the WKWebView and its
                // topmost host container to the root view. Tauri's generated
                // hierarchy can insert an intermediate safe-area wrapper,
                // so pinning only the webview's immediate parent is not enough.
                [self forceEdgeToEdge:keyWindow hostView:hostView];

                keyWindow.backgroundColor = splashColor;
                hostView.backgroundColor = splashColor;
                [self updateWebViewBackgroundsInView:keyWindow color:splashColor opaque:NO];

                // After the splash fades (~300ms opacity + buffer), switch
                // native fallbacks back to the system background so any
                // transient overdraw matches iOS chrome instead of the splash.
                dispatch_after(
                    dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)),
                    dispatch_get_main_queue(), ^{
                        keyWindow.backgroundColor = UIColor.systemBackgroundColor;
                        hostView.backgroundColor = UIColor.systemBackgroundColor;
                        [self updateWebViewBackgroundsInView:keyWindow
                                                       color:UIColor.clearColor
                                                      opaque:NO];
                    });
            }

            [[NSNotificationCenter defaultCenter] removeObserver:observer];
        }];
}

// Recursively find WKWebView and force it to fill the entire host view.
+ (void)forceEdgeToEdge:(UIView *)view hostView:(UIView *)hostView {
    if ([view isKindOfClass:[WKWebView class]]) {
        WKWebView *webView = (WKWebView *)view;

        [self normalizeAncestorChainForView:webView untilHostView:hostView];

        UIView *parent = webView.superview;
        if (parent) {
            [self pinView:webView toEdgesOfView:parent];
        }

        UIView *topContainer = [self topmostContainerForView:webView withinHostView:hostView];
        if (topContainer && topContainer != hostView) {
            [self pinView:topContainer toEdgesOfView:hostView];
        }

        webView.scrollView.contentInsetAdjustmentBehavior =
            UIScrollViewContentInsetAdjustmentNever;
        webView.scrollView.contentInset = UIEdgeInsetsZero;
        webView.scrollView.scrollIndicatorInsets = UIEdgeInsetsZero;
        if (@available(iOS 13.0, *)) {
            webView.scrollView.automaticallyAdjustsScrollIndicatorInsets = NO;
        }

        return;
    }
    for (UIView *subview in view.subviews) {
        [self forceEdgeToEdge:subview hostView:hostView];
    }
}

+ (void)prepareContainerView:(UIView *)view {
    if (!view) return;

    view.insetsLayoutMarginsFromSafeArea = NO;
    view.preservesSuperviewLayoutMargins = NO;
    view.layoutMargins = UIEdgeInsetsZero;
}

+ (void)normalizeAncestorChainForView:(UIView *)view untilHostView:(UIView *)hostView {
    UIView *current = view;
    while (current) {
        [self prepareContainerView:current];
        if (current == hostView) {
            break;
        }
        current = current.superview;
    }
}

+ (UIView *)topmostContainerForView:(UIView *)view withinHostView:(UIView *)hostView {
    UIView *candidate = view;
    while (candidate.superview && candidate.superview != hostView) {
        candidate = candidate.superview;
    }
    return candidate;
}

+ (void)pinView:(UIView *)view toEdgesOfView:(UIView *)container {
    if (!view || !container) return;

    [self prepareContainerView:container];

    view.translatesAutoresizingMaskIntoConstraints = NO;

    NSMutableArray<NSLayoutConstraint *> *constraintsToRemove = [NSMutableArray array];
    for (NSLayoutConstraint *constraint in container.constraints) {
        if (constraint.firstItem == view || constraint.secondItem == view) {
            [constraintsToRemove addObject:constraint];
        }
    }
    [NSLayoutConstraint deactivateConstraints:constraintsToRemove];

    [NSLayoutConstraint activateConstraints:@[
        [view.topAnchor constraintEqualToAnchor:container.topAnchor],
        [view.bottomAnchor constraintEqualToAnchor:container.bottomAnchor],
        [view.leadingAnchor constraintEqualToAnchor:container.leadingAnchor],
        [view.trailingAnchor constraintEqualToAnchor:container.trailingAnchor],
    ]];
}

+ (void)updateWebViewBackgroundsInView:(UIView *)view color:(UIColor *)color opaque:(BOOL)opaque {
    if ([view isKindOfClass:[WKWebView class]]) {
        WKWebView *webView = (WKWebView *)view;
        webView.backgroundColor = color;
        webView.scrollView.backgroundColor = color;
        webView.opaque = opaque;
    }

    for (UIView *subview in view.subviews) {
        [self updateWebViewBackgroundsInView:subview color:color opaque:opaque];
    }
}

@end
