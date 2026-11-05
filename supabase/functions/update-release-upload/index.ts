import {makeUpdateReleaseUploadHandler} from '../_shared/update-release-upload.mjs';
Deno.serve(makeUpdateReleaseUploadHandler({env:(key:string)=>Deno.env.get(key)}));
