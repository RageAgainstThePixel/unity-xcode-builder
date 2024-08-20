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
      apple-id: ${{ secrets.APPLE_ID }}
      apple-password: ${{ secrets.APPLE_PASSWORD }}
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
| `apple-id` | Apple ID email. | true |
| `apple-password` | Apple ID password. | true |
| `certificate` | Exported signing certificate.p12 encoded as base64 string. | true |
| `certificate-password` | The password for the exported `certificate`. | true |
| `team-id` | The team ID to use for signing the Xcode project. Overrides the value in the exported Unity project. | false |
| `bundle-id` | The bundle ID of the Xcode project. Overrides the value in the exported Unity project. | false |
| `configuration` | The configuration to build the Xcode project with. | Defaults to `Release`. |
| `xcscheme` | The path to the custom `.xcscheme` to build the Xcode project with. Overrides the value in the exported Unity project. | false |

### outputs

- `archive`: Path to the exported archive.
- `executable`: Path to the generated executable.

