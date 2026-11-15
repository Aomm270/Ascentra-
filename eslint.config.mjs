import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default [
  { ignores: [".next/**", "node_modules/**", "out/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // These images are dynamic API-generated previews; routing them through the
    // Next image optimizer adds a proxy hop without improving this small PNG.
    files: [
      "src/components/ExploreDashboard.tsx",
      "src/components/ObjectInvestigator.tsx",
      "src/components/SpectralExplorer.tsx",
    ],
    rules: { "@next/next/no-img-element": "off" },
  },
];
