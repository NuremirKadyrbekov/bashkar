import { createPlatformAdminHandler } from '../_shared/platform-admin.mjs';
Deno.serve(createPlatformAdminHandler({env:(key:string)=>Deno.env.get(key)}));
