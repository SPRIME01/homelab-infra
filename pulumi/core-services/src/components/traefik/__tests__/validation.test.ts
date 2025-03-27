import { describe, test, expect, beforeAll } from '@jest/globals';
import { Traefik } from '../';
import { setupPulumiMocks, createTestArgs } from './utils';

describe('Traefik Validation', () => {
    beforeAll(() => {
        setupPulumiMocks();
    });

    describe('Input Validation', () => {
        test('throws error on invalid TLS version', () => {
            const args = createTestArgs({
                tls: {
                    options: {
                        minVersion: 'InvalidVersion',
                    }
                }
            });

            expect(() => new Traefik('test-invalid-tls', args))
                .toThrow('Invalid TLS version');
        });

        test('throws error on invalid logging level', () => {
            const args = createTestArgs({
                logging: {
                    level: 'INVALID'
                }
            });

            expect(() => new Traefik('test-invalid-log', args))
                .toThrow('Invalid log level');
        });

        test('throws error on negative replica count', () => {
            const args = createTestArgs({
                replicas: -1
            });

            expect(() => new Traefik('test-invalid-replicas', args))
                .toThrow('Replica count must be positive');
        });

        test('throws error on invalid memory format', () => {
            const args = createTestArgs({
                resources: {
                    requests: {
                        memory: 'invalid'
                    }
                }
            });

            expect(() => new Traefik('test-invalid-memory', args))
                .toThrow('Invalid memory format');
        });

        test('throws error on invalid CPU format', () => {
            const args = createTestArgs({
                resources: {
                    requests: {
                        cpu: '1.5.0'
                    }
                }
            });

            expect(() => new Traefik('test-invalid-cpu', args))
                .toThrow('Invalid CPU format');
        });
    });

    describe('Dashboard Validation', () => {
        test('throws error when dashboard auth is enabled but credentials are missing', () => {
            const args = createTestArgs({
                dashboard: {
                    enabled: true,
                    domain: 'test.local',
                    auth: {
                        enabled: true
                        // Missing username and passwordHash
                    }
                }
            });

            expect(() => new Traefik('test-invalid-auth', args))
                .toThrow('Dashboard auth enabled but credentials are missing');
        });

        test('throws error on invalid domain format', () => {
            const args = createTestArgs({
                dashboard: {
                    enabled: true,
                    domain: 'invalid domain'
                }
            });

            expect(() => new Traefik('test-invalid-domain', args))
                .toThrow('Invalid domain format');
        });
    });

    describe('Middleware Validation', () => {
        test('throws error on invalid STS seconds', () => {
            const args = createTestArgs({
                middlewares: {
                    headers: {
                        enabled: true,
                        stsSeconds: -1
                    }
                }
            });

            expect(() => new Traefik('test-invalid-sts', args))
                .toThrow('STS seconds must be positive');
        });

        test('throws error on invalid rate limit values', () => {
            const args = createTestArgs({
                middlewares: {
                    rateLimit: {
                        enabled: true,
                        average: -10,
                        burst: 0
                    }
                }
            });

            expect(() => new Traefik('test-invalid-rate-limit', args))
                .toThrow('Rate limit values must be positive');
        });
    });
});
