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
@property (nonatomic, assign) CGFloat lastKeyboardInset;
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
        _lastKeyboardInset = -1;
        NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
        // UIKeyboardWillChangeFrameNotification is the only notification that
        // fires for every relevant transition — show, hide, floating/dock
        // toggles, candidate-bar resizes, hardware-keyboard reveal/hide, and
        // split-keyboard merges. Show/Hide notifications skip several of those.
        [center addObserver:self
                   selector:@selector(keyboardFrameWillChange:)
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

- (void)pushKeyboardInset:(CGFloat)inset
            animationDuration:(NSTimeInterval)duration {
    WKWebView *webView = [self resolveWebView];
    if (!webView) {
        return;
    }
    [self configureScrollViewIfNeeded:webView];

    CGFloat rounded = MAX(0, round(inset));
    if (fabs(rounded - self.lastKeyboardInset) < 0.5) {
        return;
    }
    self.lastKeyboardInset = rounded;

    NSInteger durationMs = (NSInteger)round(MAX(0, duration) * 1000.0);
    // Publish the height of the area above the keyboard. `#root` reads this
    // variable directly via `height: var(--visual-viewport-height)`. Sourcing
    // it from webView.bounds (not from a CSS `100%` chain) sidesteps iOS 26's
    // double-shrink behaviour where the layout viewport also collapses.
    CGFloat visualHeight = MAX(0, round(webView.bounds.size.height - rounded));

    // Convention: data-keyboard-visible is a boolean *presence* attribute —
    // present means the keyboard is up, absent means it isn't. Don't set it to
    // the string "false" or CSS selectors like [data-keyboard-visible] will
    // still match. data-keyboard-source stays pinned to "native" so the JS
    // viewport tracker can detect us and step aside.
    NSString *script = [NSString stringWithFormat:
        @"(function(){var d=document.documentElement;if(!d)return;"
         "d.style.setProperty('--keyboard-inset','%.0fpx');"
         "d.style.setProperty('--visual-viewport-height','%.0fpx');"
         "d.style.setProperty('--keyboard-animation-duration','%ldms');"
         "d.dataset.keyboardSource='native';"
         "if(%@){d.dataset.keyboardVisible='';}"
         "else{delete d.dataset.keyboardVisible;}})();",
        rounded,
        visualHeight,
        (long)durationMs,
        rounded > 0 ? @"true" : @"false"];

    dispatch_async(dispatch_get_main_queue(), ^{
        [webView evaluateJavaScript:script completionHandler:nil];
    });
}

- (CGFloat)keyboardOverlapInWebView:(WKWebView *)webView
                   fromNotification:(NSNotification *)note
                            visible:(BOOL)visible {
    if (!visible || !webView) {
        return 0;
    }

    NSValue *frameValue = note.userInfo[UIKeyboardFrameEndUserInfoKey];
    if (!frameValue) {
        return 0;
    }
    CGRect keyboardFrameInScreen = [frameValue CGRectValue];

    UIWindow *window = webView.window;
    if (!window) {
        return 0;
    }

    // UIKeyboardFrameEndUserInfoKey returns the frame in the screen's
    // coordinate space. Convert it to the webView's local space so the math
    // is correct under Split View, Slide Over, Stage Manager, and any other
    // case where the webView doesn't fill the screen.
    UIScreen *screen = window.screen;
    id<UICoordinateSpace> sourceSpace = screen ? screen.coordinateSpace
                                               : (id<UICoordinateSpace>)window;
    CGRect keyboardFrameInView = [webView convertRect:keyboardFrameInScreen
                                  fromCoordinateSpace:sourceSpace];

    // Floating / undocked iPad keyboards report a frame somewhere in the
    // middle of the webView; they should not push content. We require the
    // overlap to actually touch the bottom edge.
    CGRect overlap = CGRectIntersection(webView.bounds, keyboardFrameInView);
    if (CGRectIsNull(overlap) || overlap.size.height <= 0) {
        return 0;
    }

    // Sanity clamp. During certain iOS 26 transitions (scene-size changes,
    // Stage Manager geometry shifts, IME handoff between languages) the
    // notification can briefly report the keyboard as occupying nearly the
    // entire webview. Applying that inset would collapse `#root` to a sliver
    // and visually park the compose bar near the top of the screen with a
    // wall of black underneath. Discard such reports — iOS will fire the
    // next notification with the correct frame and the UI snaps back.
    if (overlap.size.height > webView.bounds.size.height * 0.85) {
        NSLog(@"[PrivateTalk] discarding suspicious keyboard overlap %.0fpx "
              @"(webview height %.0fpx, keyboard frame in view %@)",
              overlap.size.height,
              webView.bounds.size.height,
              NSStringFromCGRect(keyboardFrameInView));
        return 0;
    }

    CGFloat distanceFromBottom =
        CGRectGetMaxY(webView.bounds) - CGRectGetMaxY(overlap);
    if (distanceFromBottom > 1.0) {
        return 0;
    }

    return overlap.size.height;
}

- (NSTimeInterval)animationDurationFromNotification:(NSNotification *)note {
    NSNumber *value = note.userInfo[UIKeyboardAnimationDurationUserInfoKey];
    if (![value isKindOfClass:[NSNumber class]]) {
        return 0;
    }
    return value.doubleValue;
}

- (void)keyboardFrameWillChange:(NSNotification *)note {
    WKWebView *webView = [self resolveWebView];
    CGFloat inset = [self keyboardOverlapInWebView:webView
                                  fromNotification:note
                                           visible:YES];
    [self pushKeyboardInset:inset
            animationDuration:[self animationDurationFromNotification:note]];
}

- (void)keyboardWillHide:(NSNotification *)note {
    [self pushKeyboardInset:0
            animationDuration:[self animationDurationFromNotification:note]];
}

@end

__attribute__((constructor))
static void pt_install_keyboard_bridge(void) {
    // Force initialization of the singleton so notifications are observed from launch.
    dispatch_async(dispatch_get_main_queue(), ^{
        (void)[PTKeyboardBridge shared];
    });
}
