#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

#pragma mark - Input accessory bar removal

static UIView *pt_empty_input_accessory_view(id self, SEL _cmd) {
    return nil;
}

__attribute__((constructor))
static void pt_disable_wkcontentview_input_accessory_view(void) {
    Class target = NSClassFromString(@"WKContentView");
    if (target == Nil) {
        return;
    }

    SEL selector = sel_registerName("inputAccessoryView");
    Method original = class_getInstanceMethod(target, selector);
    if (original == NULL) {
        return;
    }

    const char *types = method_getTypeEncoding(original);
    if (types == NULL) {
        types = "@@:";
    }

    if (!class_addMethod(target, selector, (IMP)pt_empty_input_accessory_view, types)) {
        method_setImplementation(original, (IMP)pt_empty_input_accessory_view);
    }
}

#pragma mark - Keyboard-aware viewport bridge

@interface PTKeyboardBridge : NSObject
@property (nonatomic, weak) WKWebView *webView;
@property (nonatomic, assign) CGFloat lastKeyboardHeight;
@property (nonatomic, assign) BOOL configuredScrollView;
@end

@implementation PTKeyboardBridge

+ (instancetype)shared {
    static PTKeyboardBridge *instance;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [PTKeyboardBridge new];
    });
    return instance;
}

- (instancetype)init {
    if ((self = [super init])) {
        _lastKeyboardHeight = -1;
        NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
        [center addObserver:self
                   selector:@selector(keyboardFrameDidChange:)
                       name:UIKeyboardWillChangeFrameNotification
                     object:nil];
        [center addObserver:self
                   selector:@selector(keyboardWillHide:)
                       name:UIKeyboardWillHideNotification
                     object:nil];
    }
    return self;
}

- (WKWebView *)resolveWebView {
    if (self.webView) {
        return self.webView;
    }

    WKWebView *found = nil;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:[UIWindowScene class]]) {
            continue;
        }
        UIWindowScene *windowScene = (UIWindowScene *)scene;
        for (UIWindow *window in windowScene.windows) {
            found = [self findWebViewInView:window];
            if (found) break;
        }
        if (found) break;
    }
    self.webView = found;
    return found;
}

- (WKWebView *)findWebViewInView:(UIView *)view {
    if ([view isKindOfClass:[WKWebView class]]) {
        return (WKWebView *)view;
    }
    for (UIView *subview in view.subviews) {
        WKWebView *match = [self findWebViewInView:subview];
        if (match) {
            return match;
        }
    }
    return nil;
}

- (void)configureScrollViewIfNeeded:(WKWebView *)webView {
    if (self.configuredScrollView || !webView) {
        return;
    }
    UIScrollView *scrollView = webView.scrollView;
    scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    scrollView.contentInset = UIEdgeInsetsZero;
    scrollView.scrollIndicatorInsets = UIEdgeInsetsZero;
    scrollView.automaticallyAdjustsScrollIndicatorInsets = NO;
    scrollView.bounces = NO;
    scrollView.scrollEnabled = NO;
    self.configuredScrollView = YES;
}

- (void)pushKeyboardHeight:(CGFloat)height {
    WKWebView *webView = [self resolveWebView];
    if (!webView) {
        return;
    }
    [self configureScrollViewIfNeeded:webView];

    CGFloat rounded = MAX(0, round(height));
    if (fabs(rounded - self.lastKeyboardHeight) < 0.5) {
        return;
    }
    self.lastKeyboardHeight = rounded;

    NSString *script = [NSString stringWithFormat:
        @"(function(){var d=document.documentElement;if(!d)return;d.style.setProperty('--keyboard-inset','%.0fpx');"
         "d.style.setProperty('--visual-viewport-height', 'calc(100vh - %.0fpx)');"
         "d.dataset.keyboardVisible = %@;})();",
        rounded, rounded, rounded > 0 ? @"'true'" : @"'false'"];

    dispatch_async(dispatch_get_main_queue(), ^{
        [webView evaluateJavaScript:script completionHandler:nil];
    });
}

- (CGFloat)keyboardHeightFromNotification:(NSNotification *)note visible:(BOOL)visible {
    if (!visible) {
        return 0;
    }
    NSValue *frameValue = note.userInfo[UIKeyboardFrameEndUserInfoKey];
    if (!frameValue) {
        return 0;
    }
    CGRect frame = [frameValue CGRectValue];
    UIWindow *window = nil;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:[UIWindowScene class]]) continue;
        for (UIWindow *candidate in ((UIWindowScene *)scene).windows) {
            if (candidate.isKeyWindow) { window = candidate; break; }
        }
        if (!window) {
            window = ((UIWindowScene *)scene).windows.firstObject;
        }
        if (window) break;
    }
    CGRect screenBounds = window ? window.bounds : [UIScreen mainScreen].bounds;
    CGFloat overlap = CGRectGetMaxY(screenBounds) - CGRectGetMinY(frame);
    return MAX(0, overlap);
}

- (void)keyboardFrameDidChange:(NSNotification *)note {
    CGFloat height = [self keyboardHeightFromNotification:note visible:YES];
    [self pushKeyboardHeight:height];
}

- (void)keyboardWillHide:(NSNotification *)note {
    [self pushKeyboardHeight:0];
}

@end

__attribute__((constructor))
static void pt_install_keyboard_bridge(void) {
    // Force initialization of the singleton so notifications are observed from launch.
    dispatch_async(dispatch_get_main_queue(), ^{
        (void)[PTKeyboardBridge shared];
    });
}
