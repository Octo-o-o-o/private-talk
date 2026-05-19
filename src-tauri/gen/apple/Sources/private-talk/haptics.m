#import <UIKit/UIKit.h>

/*
 * Haptic feedback bridge.
 *
 * iOS exposes three feedback-generator families, each pre-tuned for a
 * different intent:
 *
 *   - UIImpactFeedbackGenerator       (.light/.medium/.heavy/.soft/.rigid)
 *       For "something happened in the UI" — taps, toggles, confirmations.
 *   - UINotificationFeedbackGenerator (.success/.warning/.error)
 *       For terminal outcomes (success / warning / failure).
 *   - UISelectionFeedbackGenerator
 *       For continuous discrete steps — picker scrubbing, PIN digit taps.
 *
 * Generators must be `prepare`d before `impact/notify/selection` to avoid
 * a noticeable lag on first use; we always create + prepare per call rather
 * than hold a singleton, because the system penalizes long-lived generators
 * by suspending them anyway.
 *
 * Touching UIKit objects from anywhere but the main thread is unsafe, so we
 * dispatch_async to the main queue. The Rust caller doesn't need a return
 * value — haptics are best-effort.
 */

__attribute__((visibility("default")))
void pt_haptic_impact(int style) {
    dispatch_async(dispatch_get_main_queue(), ^{
        UIImpactFeedbackStyle resolved;
        switch (style) {
            case 0:  resolved = UIImpactFeedbackStyleLight; break;
            case 1:  resolved = UIImpactFeedbackStyleMedium; break;
            case 2:  resolved = UIImpactFeedbackStyleHeavy; break;
            // .soft / .rigid require iOS 13+; the SDK targets 13+ so they're safe.
            case 3:  resolved = UIImpactFeedbackStyleSoft; break;
            case 4:  resolved = UIImpactFeedbackStyleRigid; break;
            default: resolved = UIImpactFeedbackStyleMedium; break;
        }
        UIImpactFeedbackGenerator *gen =
            [[UIImpactFeedbackGenerator alloc] initWithStyle:resolved];
        [gen prepare];
        [gen impactOccurred];
    });
}

__attribute__((visibility("default")))
void pt_haptic_notification(int type) {
    dispatch_async(dispatch_get_main_queue(), ^{
        UINotificationFeedbackType resolved;
        switch (type) {
            case 0:  resolved = UINotificationFeedbackTypeSuccess; break;
            case 1:  resolved = UINotificationFeedbackTypeWarning; break;
            case 2:  resolved = UINotificationFeedbackTypeError; break;
            default: resolved = UINotificationFeedbackTypeSuccess; break;
        }
        UINotificationFeedbackGenerator *gen =
            [UINotificationFeedbackGenerator new];
        [gen prepare];
        [gen notificationOccurred:resolved];
    });
}

__attribute__((visibility("default")))
void pt_haptic_selection(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        UISelectionFeedbackGenerator *gen = [UISelectionFeedbackGenerator new];
        [gen prepare];
        [gen selectionChanged];
    });
}
