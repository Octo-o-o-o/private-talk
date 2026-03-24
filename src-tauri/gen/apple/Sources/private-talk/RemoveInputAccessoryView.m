#import <UIKit/UIKit.h>
#import <objc/runtime.h>

// Remove the iOS keyboard input accessory bar (navigation arrows + done button)
// that WKWebView adds by default for form inputs.
@implementation UIView (RemoveInputAccessoryView)

+ (void)load {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        Class contentViewClass = NSClassFromString(@"WKContentView");
        if (!contentViewClass) return;

        SEL selector = @selector(inputAccessoryView);
        IMP nilAccessoryView = imp_implementationWithBlock(^(id _self) {
            return (UIView *)nil;
        });

        Method existing = class_getInstanceMethod(contentViewClass, selector);
        if (existing) {
            method_setImplementation(existing, nilAccessoryView);
        } else {
            class_addMethod(contentViewClass, selector, nilAccessoryView, "@@:");
        }
    });
}

@end
