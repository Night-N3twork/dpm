export interface ExecOptions {
    cwd: string;
    packageName?: string;
    command: string;
    args: string[];
    tempInstall?: boolean;
}
export declare const execCommand: (opts: ExecOptions) => Promise<number>;
//# sourceMappingURL=exec.d.ts.map