export default {
  providers: [
    {
      // Clerk Frontend API URL — found in Clerk Dashboard → API Keys.
      // Set this as a Convex env var: npx convex env set CLERK_ISSUER_URL <value>
      // Also create a JWT template named "convex" in the Clerk Dashboard.
      domain: process.env.CLERK_ISSUER_URL,
      applicationID: 'convex',
    },
  ],
}
