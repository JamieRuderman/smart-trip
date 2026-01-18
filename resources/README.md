# App Assets

Place your source images here for generating app icons and splash screens.

## Required Files

### `icon.png`
- **Size**: 1024x1024 pixels
- **Format**: PNG (no transparency for iOS)
- Used to generate all app icon sizes for iOS and Android

### `splash.png`
- **Size**: 2732x2732 pixels
- **Format**: PNG
- Keep important content centered in a ~1200x1200 safe zone
- Used to generate all splash screen sizes for iOS and Android

## Optional Files

### `icon-foreground.png`
- **Size**: 1024x1024 pixels
- Android adaptive icon foreground layer (if you want a different adaptive icon)

### `icon-background.png`
- **Size**: 1024x1024 pixels
- Android adaptive icon background layer

## Generating Assets

After placing your images here, run:

```bash
npm run assets
```

This will generate all required sizes and place them in the iOS and Android projects.

## Tips

- **Icon**: Keep it simple and recognizable at small sizes. Avoid fine details.
- **Splash**: Use a solid background color that matches your app's theme.
- **Colors**: Consider using SMART's brand green (#11ab75) as your primary color.
