import { describe, test, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import * as k8s from "@pulumi/kubernetes";
import { Traefik } from '../';
import { DEFAULT_NAMESPACE } from '../constants';
import {
    MockCall,
    MockFn,
    setupPulumiMocks,
    setupMockCustomResource,
    findResourceInCalls,
    createTestArgs
} from './utils';

describe('Traefik Integration', () => {
    let mockResource: { mock: MockFn; restore: () => void };

    beforeAll(() => {
        setupPulumiMocks();
    });

    beforeEach(() => {
        mockResource = setupMockCustomResource();
    });

    afterEach(() => {
        mockResource.restore();
        jest.clearAllMocks();
    });

    test('dashboard with auth uses secure headers middleware', async () => {
        const args = createTestArgs({
            dashboard: {
                enabled: true,
                domain: 'traefik.example.com',
                auth: {
                    enabled: true,
                    username: 'admin',
                    passwordHash: '$2y$05$example'
                }
            },
            middlewares: {
                headers: {
                    enabled: true,
                    sslRedirect: true,
                    stsSeconds: 315360000
                }
            }
        });

        const traefik = new Traefik('test-integration', args);
        await (traefik as any).ready;

        const calls = mockResource.mock.mock.calls as MockCall[];

        const dashboardRoute = findResourceInCalls(calls, 'IngressRoute', undefined, 'traefik-dashboard');
        expect(dashboardRoute).toBeDefined();
        expect(dashboardRoute![1].spec.routes[0].middlewares).toContainEqual({
            name: 'secure-headers',
            namespace: DEFAULT_NAMESPACE
        });
        expect(dashboardRoute![1].spec.routes[0].middlewares).toContainEqual({
            name: 'traefik-auth',
            namespace: DEFAULT_NAMESPACE
        });
    });

    test('TLS options apply to all secure endpoints', async () => {
        const args = createTestArgs({
            dashboard: {
                enabled: true,
                domain: 'traefik.example.com'
            },
            tls: {
                options: {
                    minVersion: 'VersionTLS12',
                    cipherSuites: ['TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256']
                }
            }
        });

        const traefik = new Traefik('test-tls-integration', args);
        await (traefik as any).ready;

        const calls = mockResource.mock.mock.calls as MockCall[];

        const tlsOptions = findResourceInCalls(calls, 'TLSOption', undefined, 'default');
        expect(tlsOptions).toBeDefined();

        const dashboardRoute = findResourceInCalls(calls, 'IngressRoute', undefined, 'traefik-dashboard');
        expect(dashboardRoute).toBeDefined();
        expect(dashboardRoute![1].spec.entryPoints).toContain('websecure');
    });

    test('resource limits apply with middleware enabled', async () => {
        const args = createTestArgs({
            resources: {
                requests: {
                    cpu: '200m',
                    memory: '256Mi'
                }
            },
            middlewares: {
                rateLimit: {
                    enabled: true,
                    average: 100,
                    burst: 50
                }
            }
        });

        const traefik = new Traefik('test-resources-middleware', args);
        await (traefik as any).ready;

        const calls = mockResource.mock.mock.calls as MockCall[];

        const controller = findResourceInCalls(calls, 'TraefikController');
        expect(controller).toBeDefined();
        expect(controller![1].spec.resources.requests.cpu).toBe('200m');

        const rateLimit = findResourceInCalls(calls, 'Middleware', undefined, 'rate-limit');
        expect(rateLimit).toBeDefined();
    });

    test('combines multiple middleware chains correctly', async () => {
        const args = createTestArgs({
            dashboard: {
                enabled: true,
                domain: 'traefik.example.com',
                auth: {
                    enabled: true,
                    username: 'admin',
                    passwordHash: '$2y$05$example'
                }
            },
            middlewares: {
                headers: {
                    enabled: true,
                    sslRedirect: true
                },
                rateLimit: {
                    enabled: true,
                    average: 100,
                    burst: 50
                }
            }
        });

        const traefik = new Traefik('test-middleware-chain', args);
        await (traefik as any).ready;

        const calls = mockResource.mock.mock.calls as MockCall[];

        const dashboardRoute = findResourceInCalls(calls, 'IngressRoute', undefined, 'traefik-dashboard');
        expect(dashboardRoute).toBeDefined();

        const middlewares = dashboardRoute![1].spec.routes[0].middlewares;
        expect(middlewares).toContainEqual({ name: 'secure-headers', namespace: DEFAULT_NAMESPACE });
        expect(middlewares).toContainEqual({ name: 'rate-limit', namespace: DEFAULT_NAMESPACE });
        expect(middlewares).toContainEqual({ name: 'traefik-auth', namespace: DEFAULT_NAMESPACE });

        // Verify middleware order
        const middlewareNames = middlewares.map((m: any) => m.name);
        expect(middlewareNames.indexOf('secure-headers'))
            .toBeLessThan(middlewareNames.indexOf('traefik-auth'));
    });
});
