import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  {
    // react-three-fiber drives three.js by mutating the scene graph —material
    // colours, emissive intensity and fog distances are written imperatively
    // every frame. That is the library's documented model, not an accident.
    //
    // react-hooks/immutability assumes anything a hook returns is frozen, which
    // is the right default for React state and the wrong one for a THREE
    // material held in useMemo. Moving the materials into refs only trades this
    // for react-hooks/refs, so the rule is switched off for the scene files
    // specifically rather than the code being bent around it.
    //
    // React Compiler is not enabled in this project (no babel-plugin-react-
    // compiler, no reactCompiler flag in next.config.ts), so nothing downstream
    // relies on the immutability the rule is protecting. Revisit if it is ever
    // turned on.
    files: ["components/Block.tsx", "components/Plot.tsx"],
    rules: {
      "react-hooks/immutability": "off",
    },
  },
]);

export default eslintConfig;
