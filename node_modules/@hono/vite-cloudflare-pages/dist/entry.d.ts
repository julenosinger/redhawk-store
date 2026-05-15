type Options = {
    entry: string[];
};
declare const getEntryContent: (options: Options) => Promise<string>;

export { Options, getEntryContent };
