export interface JPMAuth {
    username: string
    password: string
}
export interface JPMRepository {
    name: string
    uri: string
    authentication?: JPMAuth
}

export interface JPMDependency {
    group: string
    artifact: string
    version: string
    classifier?: string
    refreshInterval?: number
    bom?: boolean
}

export interface JPMCompiler {
    name: string
    exec: string
    output: string
    input: string
    generated: string
    args: string[]
}

export interface JPMPackager {
    name: string
    exec: string
    input: string
    output: string
    excludes: string[]
    args: string[]
}

export interface JPMConfig {
    localRepository: JPMRepository
    devRepositories: JPMRepository[]
    repositories: JPMRepository[]
    dependencies: JPMDependency[]
    devDependencies: JPMDependency[]
    compilers: JPMCompiler[]
    packagers: JPMPackager[]
}

export enum DependencyScope {
    compile,
    provided,
    runtime,
    test,
    system
}

export interface POMDependency {
    jpmDep: JPMDependency
    groupId: string
    artifactId: string
    version: string
    classifier?: string
    type?: string
    scope?: "compile"|"provided"|"runtime"|"test"|"system"|"import"|undefined
    optional?: boolean
    transitive?: boolean
    bom?: boolean
    resolved?: boolean
}

export interface POMDependencies {
    dependency: POMDependency[]
}

export interface POMDependencyManagement {
    dependencies: POMDependencies
}

export interface POMProject {
    modelVersion: string
    groupId: string
    artifactId: string
    version: string
    packaging: string
    name: string
    description: string
    properties: any
    dependencies: POMDependencies
    dependencyManagement: POMDependencyManagement
}

export interface POM {
    project: POMProject
}

export interface ResolvedDependency {
    pomDep: POMDependency
    file: string
    srcFile: string
}