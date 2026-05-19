#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>

/*
 * Biometric authentication bridge.
 *
 * We use LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)
 * rather than the broader .deviceOwnerAuthentication policy on purpose:
 * Private Talk already owns a PIN; Face ID / Touch ID is offered as a
 * convenience shortcut for the *same* PIN, not as a separate identity. If
 * the user opts out of biometrics or biometric fails / is locked out, the
 * UI falls back to the PIN keypad — letting LAContext show the system PIN
 * sheet on top would be confusing.
 *
 * The Rust side calls into:
 *
 *   pt_biometric_available(out_type) -> int (0 = unavailable, 1 = available)
 *   pt_biometric_evaluate(reason_utf8, completion)
 *
 * Because LAContext.evaluatePolicy is asynchronous and dispatches its
 * callback off the main thread, we return BOOL from a synchronous call and
 * use a semaphore inside to keep the FFI shape simple. The Tauri command is
 * already async on the JS side, so blocking briefly on a Rust worker thread
 * is fine.
 */

typedef NS_ENUM(int, PTBiometryKind) {
    PTBiometryKindNone = 0,
    PTBiometryKindTouchID = 1,
    PTBiometryKindFaceID = 2,
    PTBiometryKindOpticID = 3,
};

__attribute__((visibility("default")))
int pt_biometric_available(int *out_kind) {
    LAContext *ctx = [LAContext new];
    NSError *error = nil;
    BOOL ok = [ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                               error:&error];
    if (out_kind != NULL) {
        if (!ok) {
            *out_kind = PTBiometryKindNone;
        } else {
            switch (ctx.biometryType) {
                case LABiometryTypeFaceID:
                    *out_kind = PTBiometryKindFaceID;
                    break;
                case LABiometryTypeTouchID:
                    *out_kind = PTBiometryKindTouchID;
                    break;
                default:
                    // LABiometryTypeOpticID on visionOS — guarded by raw
                    // value because the symbol only exists on newer SDKs.
                    if ((NSInteger)ctx.biometryType == 3) {
                        *out_kind = PTBiometryKindOpticID;
                    } else {
                        *out_kind = PTBiometryKindNone;
                    }
                    break;
            }
        }
    }
    return ok ? 1 : 0;
}

/// Returns 1 on success, 0 on user cancel / authentication failure, -1 on
/// hardware unavailability or other errors. When non-success, *out_error
/// (if non-NULL) receives a heap-allocated UTF-8 description; the caller
/// must release it with pt_biometric_string_free.
__attribute__((visibility("default")))
int pt_biometric_evaluate(const char *reason_utf8, char **out_error) {
    if (reason_utf8 == NULL) {
        if (out_error != NULL) *out_error = strdup("missing reason string");
        return -1;
    }
    NSString *reason = [NSString stringWithUTF8String:reason_utf8];
    if (reason.length == 0) {
        if (out_error != NULL) *out_error = strdup("empty reason string");
        return -1;
    }

    LAContext *ctx = [LAContext new];
    // localizedFallbackTitle = @"" suppresses the "Enter Passcode" button
    // because we never want LAContext to take over the auth flow.
    ctx.localizedFallbackTitle = @"";

    NSError *availabilityError = nil;
    if (![ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
                          error:&availabilityError]) {
        if (out_error != NULL) {
            *out_error = strdup(
                availabilityError.localizedDescription.UTF8String ?: "biometry unavailable");
        }
        return -1;
    }

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block BOOL success = NO;
    __block NSString *errorMessage = nil;

    [ctx evaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics
        localizedReason:reason
                  reply:^(BOOL authOk, NSError *authError) {
        success = authOk;
        if (!authOk && authError != nil) {
            errorMessage = authError.localizedDescription;
        }
        dispatch_semaphore_signal(sem);
    }];

    dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);

    if (success) {
        return 1;
    }
    if (out_error != NULL && errorMessage != nil) {
        *out_error = strdup(errorMessage.UTF8String ?: "biometry failed");
    }
    return 0;
}

__attribute__((visibility("default")))
void pt_biometric_string_free(char *ptr) {
    if (ptr != NULL) {
        free(ptr);
    }
}
