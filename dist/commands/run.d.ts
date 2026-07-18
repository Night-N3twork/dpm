export interface RunOptions {
    cwd: string;
    script: string;
    args: string[];
}
export declare const runCommand: (opts: RunOptions) => Promise<number>;
//# sourceMappingURL=run.d.ts.map