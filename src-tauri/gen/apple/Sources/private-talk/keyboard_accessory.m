#import <UIKit/UIKit.h>
#import <objc/runtime.h>

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
