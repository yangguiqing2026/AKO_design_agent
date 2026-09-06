/**
 * Jest 配置（AKO Design Agent）
 * - 测试目录统一放置在 tests/ 下（unit / integration / compliance）
 * - ts-jest 编译，独立覆盖 tsconfig（测试目录不在 tsconfig.rootDir 内）
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'ES2020',
          module: 'commonjs',
          moduleResolution: 'node',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          rootDir: '.'
        }
      }
    ]
  },
  collectCoverageFrom: [
    'src/core/logger.ts',
    'src/core/version-guardian.ts',
    'src/core/dsh-adapter.ts',
    'src/core/cordis-adapter.ts',
    'src/core/session-orchestrator.ts',
    'src/bootstrap.ts',
    'src/prompts/**/*.ts',
    'src/modules/validator/**/*.ts',
    'src/modules/requirement-analyzer/**/*.ts',
    'src/modules/pattern-matcher/**/*.ts',
    'src/modules/config-generator/**/*.ts',
    'src/modules/memory/**/*.ts',
    'src/modules/session-manager/**/*.ts',
    'src/modules/learning/**/*.ts',
    'src/modules/persist/**/*.ts',
    'src/modules/tool-bridge/**/*.ts',
    'src/tools/simulate-run.tool.ts',
    'src/tools/query-patterns.tool.ts',
    'src/tools/generate-profile.tool.ts'
  ],
  coveragePathIgnorePatterns: ['/node_modules/'],
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 65,
      functions: 75,
      lines: 75
    }
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true
};
