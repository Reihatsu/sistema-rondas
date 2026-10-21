const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/**
 * Mantiene vivas las clases de ML Kit que `expo-camera` resuelve por reflexión.
 *
 * `expo-camera` decide si el escáner de códigos está disponible con
 * `Class.forName("com.google.mlkit.vision.barcode.BarcodeScanning")`
 * (ver `CameraUtils.isMLKitBarcodeScannerAvailable()`). R8 no puede ver ese uso
 * y, en los builds release con `android.enableMinifyInReleaseBuilds=true`,
 * elimina la clase. Entonces el módulo nativo fuerza
 * `barcodeScannerEnabled = false`, la cámara abre pero `onBarcodeScanned` nunca
 * se dispara y no se muestra ningún error.
 */
const MARKER = '# >>> expo-camera / ML Kit keep rules (plugins/withMlKitKeepRules.js) >>>';
const END_MARKER = '# <<< expo-camera / ML Kit keep rules <<<';

const RULES = [
  '# ML Kit se resuelve por reflexión (Class.forName), no por referencias directas.',
  '-keep class com.google.mlkit.** { *; }',
  '-keep class com.google.android.gms.internal.mlkit_vision_barcode.** { *; }',
  '-keep class com.google.android.gms.internal.mlkit_vision_barcode_bundled.** { *; }',
  '-keep class com.google.android.gms.internal.mlkit_common.** { *; }',
  '-dontwarn com.google.mlkit.**',
  '-dontwarn com.google.android.gms.internal.mlkit_**',
].join('\n');

const withMlKitKeepRules = (config) =>
  withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const proguardRulesPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro'
      );

      const currentContents = fs.existsSync(proguardRulesPath)
        ? fs.readFileSync(proguardRulesPath, 'utf8')
        : '';

      if (currentContents.includes(MARKER)) {
        return modConfig;
      }

      const block = [MARKER, RULES, END_MARKER, ''].join('\n');
      const nextContents =
        currentContents.trim().length > 0
          ? `${currentContents.trimEnd()}\n\n${block}`
          : block;

      fs.mkdirSync(path.dirname(proguardRulesPath), { recursive: true });
      fs.writeFileSync(proguardRulesPath, nextContents, 'utf8');

      return modConfig;
    },
  ]);

module.exports = withMlKitKeepRules;
