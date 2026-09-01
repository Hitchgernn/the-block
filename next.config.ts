import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray package-lock.json in the home directory makes Turbopack infer the
  // wrong workspace root. Pin it to this project.
  turbopack: { root: __dirname },

  // @strands-agents/sdk statically imports optional peer deps it does not need
  // for Bedrock — @modelcontextprotocol/sdk (MCP transports) and
  // @aws-sdk/client-s3 (context offloader storage). Bundling the SDK makes the
  // build try to resolve them and fail. Keeping it external means Node requires
  // it from node_modules at runtime instead.
  // See docs/sdk-notes.md section 6.
  serverExternalPackages: ["@strands-agents/sdk"],
};

export default nextConfig;
