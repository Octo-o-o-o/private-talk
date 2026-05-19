#import <Foundation/Foundation.h>
#import <Security/Security.h>

/*
 * iOS Keychain bridge for provider API keys.
 *
 * Without this, API keys live in plain text inside the SQLite database.
 * Even with the database file already excluded from iCloud Backup
 * (ios_privacy.m) and protected by NSFileProtectionComplete at the OS
 * level, a stolen-and-jailbroken phone would still expose the secrets on
 * disk. Migrating to `kSecClassGenericPassword` items moves the bytes
 * into the keychain partition, which is hardware-backed by Secure Enclave
 * on modern devices and excluded from iCloud sync via
 * `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
 *
 * Conventions:
 *   - kSecClass         = kSecClassGenericPassword
 *   - kSecAttrService   = the app bundle id ("com.wangyixiao.private-talk")
 *   - kSecAttrAccount   = the provider id (UUID assigned in providers table)
 *   - kSecValueData     = UTF-8 bytes of the API key string
 *   - kSecAttrAccessible
 *                       = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
 *
 * Strings returned through out-params are heap-allocated with strdup();
 * the Rust caller must release them via pt_keychain_string_free.
 */

static NSString *const kPTServiceName = @"com.wangyixiao.private-talk";

static char *pt_keychain_strdup_ns(NSString *s) {
    if (s == nil) {
        return NULL;
    }
    const char *utf8 = s.UTF8String;
    if (utf8 == NULL) {
        return NULL;
    }
    return strdup(utf8);
}

static char *pt_keychain_format_error(OSStatus status) {
    NSString *msg =
        (__bridge_transfer NSString *)SecCopyErrorMessageString(status, NULL);
    if (msg == nil) {
        msg = [NSString stringWithFormat:@"keychain error %d", (int)status];
    } else {
        msg = [NSString stringWithFormat:@"%@ (%d)", msg, (int)status];
    }
    return pt_keychain_strdup_ns(msg);
}

static NSMutableDictionary *pt_keychain_base_query(NSString *account) {
    NSMutableDictionary *query = [NSMutableDictionary dictionary];
    query[(__bridge id)kSecClass] = (__bridge id)kSecClassGenericPassword;
    query[(__bridge id)kSecAttrService] = kPTServiceName;
    query[(__bridge id)kSecAttrAccount] = account;
    return query;
}

/// Returns 1 on success, -1 on error. Caller may pass NULL for out_error.
__attribute__((visibility("default")))
int pt_keychain_set(const char *account_utf8,
                    const char *value_utf8,
                    char **out_error) {
    if (account_utf8 == NULL || value_utf8 == NULL) {
        if (out_error != NULL) *out_error = strdup("null account or value");
        return -1;
    }
    NSString *account = [NSString stringWithUTF8String:account_utf8];
    NSString *value = [NSString stringWithUTF8String:value_utf8];
    NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];

    NSMutableDictionary *query = pt_keychain_base_query(account);

    // Try update first — if the item exists we want to overwrite, not bail.
    NSDictionary *attrs = @{
        (__bridge id)kSecValueData: data,
        (__bridge id)kSecAttrAccessible:
            (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    };
    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query,
                                    (__bridge CFDictionaryRef)attrs);

    if (status == errSecItemNotFound) {
        NSMutableDictionary *insert = [query mutableCopy];
        insert[(__bridge id)kSecValueData] = data;
        insert[(__bridge id)kSecAttrAccessible] =
            (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
        status = SecItemAdd((__bridge CFDictionaryRef)insert, NULL);
    }

    if (status != errSecSuccess) {
        if (out_error != NULL) *out_error = pt_keychain_format_error(status);
        return -1;
    }
    return 1;
}

/// Returns 1 on found, 0 on not-found, -1 on error. On 1, *out_value points
/// to a heap-allocated UTF-8 string the caller must release.
__attribute__((visibility("default")))
int pt_keychain_get(const char *account_utf8,
                    char **out_value,
                    char **out_error) {
    if (account_utf8 == NULL) {
        if (out_error != NULL) *out_error = strdup("null account");
        return -1;
    }
    NSString *account = [NSString stringWithUTF8String:account_utf8];
    NSMutableDictionary *query = pt_keychain_base_query(account);
    query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    query[(__bridge id)kSecReturnData] = @YES;

    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query,
                                          &result);
    if (status == errSecItemNotFound) {
        return 0;
    }
    if (status != errSecSuccess) {
        if (out_error != NULL) *out_error = pt_keychain_format_error(status);
        return -1;
    }
    NSData *data = (__bridge_transfer NSData *)result;
    NSString *value = [[NSString alloc] initWithData:data
                                            encoding:NSUTF8StringEncoding];
    if (value == nil) {
        if (out_error != NULL) *out_error = strdup("keychain value is not utf-8");
        return -1;
    }
    if (out_value != NULL) {
        *out_value = pt_keychain_strdup_ns(value);
    }
    return 1;
}

/// Returns 1 on success or item-not-found (delete is idempotent), -1 on
/// real errors.
__attribute__((visibility("default")))
int pt_keychain_delete(const char *account_utf8, char **out_error) {
    if (account_utf8 == NULL) {
        if (out_error != NULL) *out_error = strdup("null account");
        return -1;
    }
    NSString *account = [NSString stringWithUTF8String:account_utf8];
    NSMutableDictionary *query = pt_keychain_base_query(account);
    OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
    if (status != errSecSuccess && status != errSecItemNotFound) {
        if (out_error != NULL) *out_error = pt_keychain_format_error(status);
        return -1;
    }
    return 1;
}

__attribute__((visibility("default")))
void pt_keychain_string_free(char *ptr) {
    if (ptr != NULL) {
        free(ptr);
    }
}
