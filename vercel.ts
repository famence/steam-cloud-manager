/**
 * Entire Steam Cloud Manager runs on Vercel:
 * - prerendered SEO pages at /en/ and /ru/
 * - browser UI at /app/
 * - Node.js Steam APIs at same-origin /api/*, no external API server.
 */
const commonHeaders=[
  {key:'X-Content-Type-Options',value:'nosniff'},
  {key:'Referrer-Policy',value:'no-referrer'},
  {key:'X-Frame-Options',value:'DENY'},
  {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
];
const landingCsp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const appCsp="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://shared.fastly.steamstatic.com; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const config={
  framework:'vite',
  buildCommand:'npm run check',
  installCommand:'npm ci --ignore-scripts',
  outputDirectory:'dist/public',
  trailingSlash:true,
  functions:{'api/index.ts':{maxDuration:300,supportsCancellation:true}},
  rewrites:[{source:'/api/:path*',destination:'/api/index?route=:path*'}],
  headers:[
    {source:'/(.*)',headers:commonHeaders},
    {source:'/app/(.*)',headers:[
      {key:'Content-Security-Policy',value:appCsp},
      {key:'X-Robots-Tag',value:'noindex, nofollow'},
      {key:'Cache-Control',value:'no-store'},
    ]},
    {source:'/en/(.*)',headers:[{key:'Content-Security-Policy',value:landingCsp}]},
    {source:'/ru/(.*)',headers:[{key:'Content-Security-Policy',value:landingCsp}]},
    {source:'/',headers:[{key:'Content-Security-Policy',value:landingCsp}]},
  ],
};
