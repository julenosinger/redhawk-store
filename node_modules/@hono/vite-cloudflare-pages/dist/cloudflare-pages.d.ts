import { Plugin, UserConfig, ConfigEnv } from 'vite';

type CloudflarePagesOptions = {
    /**
     * @default ['./src/index.tsx', './app/server.ts']
     */
    entry?: string | string[];
    /**
     * @default './dist'
     */
    outputDir?: string;
    external?: string[];
    /**
     * @default true
     */
    minify?: boolean;
    emptyOutDir?: boolean;
    apply?: ((this: void, config: UserConfig, env: ConfigEnv) => boolean) | undefined;
};
declare const defaultOptions: Required<Omit<CloudflarePagesOptions, 'serveStaticDir'>>;
declare const cloudflarePagesPlugin: (options?: CloudflarePagesOptions) => Plugin;

export { cloudflarePagesPlugin, defaultOptions };
