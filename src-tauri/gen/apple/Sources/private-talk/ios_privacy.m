#import <UIKit/UIKit.h>
#import <Foundation/Foundation.h>

/*
 * iOS-only privacy hardening:
 *
 *   1. pt_ios_exclude_path_from_backup() — flips
 *      NSURLIsExcludedFromBackupKey on a path so SQLite (which currently
 *      holds plaintext API keys) is not synced to iCloud Backup.
 *
 *   2. PTPrivacyOverlay — installs a UIVisualEffectView blur over every
 *      window when the scene resigns active, so the snapshot iOS captures
 *      for the App Switcher (and any subsequent screenshots while
 *      backgrounded) shows opaque blur rather than chat content. This is
 *      the standard pattern shipped by Signal, 1Password, banking apps,
 *      etc. for "Private Talk"-class apps.
 */

#pragma mark - iCloud Backup exclusion

__attribute__((visibility("default")))
BOOL pt_ios_exclude_path_from_backup(const char *c_path) {
    if (c_path == NULL) {
        return NO;
    }
    NSString *path = [NSString stringWithUTF8String:c_path];
    if (path.length == 0) {
        return NO;
    }
    NSURL *url = [NSURL fileURLWithPath:path];
    NSError *error = nil;
    BOOL ok = [url setResourceValue:@YES
                             forKey:NSURLIsExcludedFromBackupKey
                              error:&error];
    if (!ok) {
        NSLog(@"[PrivateTalk] Failed to exclude %@ from iCloud backup: %@",
              path, error);
    }
    return ok;
}

#pragma mark - Background privacy overlay

// Use a unique view tag so we can find-and-remove our overlay later without
// holding strong references to the window.
static const NSInteger kPTPrivacyOverlayTag = 0x70747076; // 'ptpv'

@interface PTPrivacyOverlay : NSObject
@end

@implementation PTPrivacyOverlay

+ (instancetype)shared {
    static PTPrivacyOverlay *instance;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [PTPrivacyOverlay new];
    });
    return instance;
}

- (instancetype)init {
    if ((self = [super init])) {
        NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
        // We attach on willDeactivate so the blur is in place *before* iOS
        // snapshots the scene for the App Switcher thumbnail.
        [center addObserver:self
                   selector:@selector(sceneWillDeactivate:)
                       name:UISceneWillDeactivateNotification
                     object:nil];
        // Removing on willEnterForeground avoids a flash where the user can
        // momentarily see content before didActivate fires; didActivate
        // stays as a belt-and-suspenders fallback for the rare edge case
        // where willEnterForeground is skipped.
        [center addObserver:self
                   selector:@selector(sceneWillEnterForeground:)
                       name:UISceneWillEnterForegroundNotification
                     object:nil];
        [center addObserver:self
                   selector:@selector(sceneDidActivate:)
                       name:UISceneDidActivateNotification
                     object:nil];
    }
    return self;
}

- (void)applyBlurToScene:(UIScene *)scene {
    if (![scene isKindOfClass:[UIWindowScene class]]) {
        return;
    }
    UIWindowScene *windowScene = (UIWindowScene *)scene;
    for (UIWindow *window in windowScene.windows) {
        if ([window viewWithTag:kPTPrivacyOverlayTag]) {
            continue;
        }
        UIBlurEffect *effect =
            [UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemMaterial];
        UIVisualEffectView *blur =
            [[UIVisualEffectView alloc] initWithEffect:effect];
        blur.tag = kPTPrivacyOverlayTag;
        blur.frame = window.bounds;
        blur.autoresizingMask =
            UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        // Don't intercept touches when we briefly re-show the window during
        // the dismissal animation.
        blur.userInteractionEnabled = NO;
        [window addSubview:blur];
    }
}

- (void)removeBlurFromScene:(UIScene *)scene {
    if (![scene isKindOfClass:[UIWindowScene class]]) {
        return;
    }
    UIWindowScene *windowScene = (UIWindowScene *)scene;
    for (UIWindow *window in windowScene.windows) {
        UIView *overlay = [window viewWithTag:kPTPrivacyOverlayTag];
        [overlay removeFromSuperview];
    }
}

- (void)sceneWillDeactivate:(NSNotification *)note {
    [self applyBlurToScene:(UIScene *)note.object];
}

- (void)sceneWillEnterForeground:(NSNotification *)note {
    [self removeBlurFromScene:(UIScene *)note.object];
}

- (void)sceneDidActivate:(NSNotification *)note {
    [self removeBlurFromScene:(UIScene *)note.object];
}

@end

__attribute__((constructor))
static void pt_install_privacy_overlay(void) {
    // Force initialization on the main queue once the runloop is up so
    // scene notifications start being observed from launch.
    dispatch_async(dispatch_get_main_queue(), ^{
        (void)[PTPrivacyOverlay shared];
    });
}
