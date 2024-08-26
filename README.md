# unity-xcode-builder

A GitHub Action to build and archive Unity exported xcode projects.

## How to use

### workflow

```yaml
steps:
  - uses: RageAgainstThePixel/unity-xcode-builder@v1
    id: xcode-build
    with:
      project-path: '/path/to/your/build/output/directory'
      app-store-connect-key: ${{ APP_STORE_CONNECT_KEY }}
      app-store-connect-key-id: ${{ secrets.APP_STORE_CONNECT_KEY }}
      app-store-connect-issuer-id: ${{ secrets.APP_STORE_CONNECT_ISSUER_ID }}
  - run: |
      echo ${{ steps.xcode-build.outputs.archive }}
      echo ${{ steps.xcode-build.outputs.executable }}
```

### inputs

| name | description | required |
| ---- | ----------- | -------- |
| `project-path` | The directory that contains the exported xcode project from Unity. | Defaults to searching the workspace for `.xcodeproj` |
| `app-store-connect-key` | The App Store Connect API AuthKey_*.p8 key encoded as base64 string. | true |
| `app-store-connect-key-id` | The key ID of the App Store Connect API key id. | true |
| `app-store-connect-issuer-id` | The issuer ID of the App Store Connect API key. | true |
| `certificate` | Exported signing certificate.p12 encoded as base64 string. Overrides the automatic signing in Xcode. | Defaults to Automatic signing. |
| `certificate-password` | The password for the exported certificate. | Required if `certificate` is provided. |
| `signing-identity` | The signing identity to use for signing the Xcode project. | Parsed from the `certificate` if not provided. |
| `provisioning-profile` | The provisioning profile to use as base64 string. Use when manually signing the Xcode project. | Defaults to Automatic signing. |
| `provisioning-profile-name` | The name of the provisioning profile file, including the type to use for signing the Xcode project. Must end with either `.mobileprovision` or `.provisionprofile`. | Required if `provisioning-profile` is provided. |
| `team-id` | The team ID to use for signing the Xcode project. | Defaults to parsing team ID from `certificate` if provided. |
| `bundle-id` | The bundle ID of the Xcode project. Overrides the value in the exported Unity project. | Defaults to parsing bundle ID from `.xcodeproj`. |
| `configuration` | The configuration to build the Xcode project with. | Defaults to `Release`. |
| `scheme` | The scheme to use when building the xcode project. | false |
| `destination` | The destination to use when building the xcode project. | Defaults to 'generic/platform={platform}'. |
| `platform` | The platform to build for. Can be one of `iOS`, `macOS`, `tvOS`, `visionOS`. | Defaults to parsing platform from `.xcodeproj`. |
| `export-option` | The export option to use for exporting the Xcode project. Can be one of `app-store`, `ad-hoc`, `package`, `enterprise`, `development`, `developer-id`, `mac-application`. | Defaults to `development` |
| `export-option-plist` | The path to custom export option plist file to use when exporting the Xcode project. | Overrides `export-option`. |
| `entitlements-plist` | The path to custom entitlements plist file. | Generates [default hardened runtime entitlements](https://developer.apple.com/documentation/security/hardened-runtime) if not provided. |
| `xcode-version` | The version of Xcode to use for building the Xcode project. | Defaults to the [latest version of Xcode on the runner](https://github.com/actions/runner-images/blob/main/images/macos/macos-13-Readme.md#xcode). |

### outputs

- `archive`: Path to the exported archive.
- `export-path`: The path to the export directory.
