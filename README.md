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
      certificate: ${{ APPLE_SIGNING_CERTIFICATE }}
      certificate-password: ${{ APPLE_SIGNING_CERTIFICATE_PASSWORD }}
  - run: |
      echo ${{ steps.xcode-build.outputs.archive }}
      echo ${{ steps.xcode-build.outputs.executable }}
```

### inputs

| name | description | required |
| ---- | ----------- | -------- |
| `project-path` | The path to the xcode project. | Defaults to searching the workspace for `.xcodeproj` |
| `app-store-connect-key` | The App Store Connect API private .p8 key encoded as base64 string. | true |
| `app-store-connect-key-id` | The key ID of the App Store Connect API key. | true |
| `app-store-connect-issuer-id` | The issuer ID of the App Store Connect API key. | true |
| `certificate` | Exported signing certificate.p12 encoded as base64 string. | true |
| `certificate-password` | The password for the exported `certificate`. | true |
| `team-id` | The team ID to use for signing the Xcode project. Overrides the value in the exported Unity project. | false |
| `bundle-id` | The bundle ID of the Xcode project. Overrides the value in the exported Unity project. | false |
| `configuration` | The configuration to build the Xcode project with. | Defaults to `Release`. |
| `xcscheme` | The path to the custom `.xcscheme` to build the Xcode project with. Overrides the value in the exported Unity project. | false |
| `export-options` | The path to custom export options plist. | false |

### outputs

- `archive`: Path to the exported archive.
- `executable`: Path to the generated executable.
