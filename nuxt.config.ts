// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  modules: [
    '@nuxtjs/tailwindcss'
  ],
  // Keep SSR false if you want a Single Page App experience
  ssr: false, 

  runtimeConfig: {
    // SERVER SIDE KEYS
    // IMPORTANT: Set these to empty strings! 
    // Nuxt will automatically read 'NUXT_BIRDEYE_API_KEY' and 'NUXT_GEMINI_API_KEY' from Netlify Env vars.
    birdeyeApiKey: '', 
    geminiApiKey: '',
    heliusApiKey: '',
    jupiterApiKey: '',
    
    // CLIENT SIDE KEYS
    public: {
      // For public keys, we can use process.env or defaults
      solanaNetwork: process.env.NUXT_PUBLIC_SOLANA_NETWORK || 'devnet',
      solanaRpcHost: process.env.NUXT_PUBLIC_SOLANA_RPC_HOST,
    }
  }
})