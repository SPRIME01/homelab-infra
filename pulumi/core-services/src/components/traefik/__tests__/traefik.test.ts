import { describe, test, expect, beforeAll, beforeEach, afterEach, jest } from '@jest/globals';
import * as k8s from "@pulumi/kubernetes";
import { Traefik } from '../';
import { TraefikArgs } from '..//types';
import { DEFAULT_NAMESPACE, DEFAULT_RESOURCES, DEFAULT_ARGUMENTS } from '../constants';
import { 
    MockCall, 
    MockFn,
    setupPulumiMocks, 
    setupMockCustomResource, 
    findResourceInCalls,
    createTestArgs 
} from './utils';

describe('Traefik', () => {
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

    describe('Basic Setup', () => {
        test('creates resources with default values', async () => {
            const args = createTestArgs();
            const traefik = new Traefik('test', args);
            await (traefik as any).ready;

            const calls = mockResource.mock.mock.calls as MockCall[];

            expect(traefik.namespace).toBe(DEFAULT_NAMESPACE);

            const subscription = findResourceInCalls(calls, 'Subscription', 'operators.coreos.com/v1alpha1');
            expect(subscription).toBeDefined();
            expect(subscription![1].metadata?.namespace).toBe(DEFAULT_NAMESPACE);

            const controller = findResourceInCalls(calls, 'TraefikController', 'traefik.io/v1alpha1');
            expect(controller).toBeDefined();
            expect(controller![1].spec.resources).toEqual(DEFAULT_RESOURCES);
            expect(controller![1].spec.additionalArguments).toEqual(DEFAULT_ARGUMENTS);
        });

        test('respects custom namespace', async () => {
            const args = createTestArgs({ namespace: 'custom-namespace' });
            const traefik = new Traefik('test-namespace', args);
            await (traefik as any).ready;

            const calls = mockResource.mock.mock.calls as MockCall[];
            expect(traefik.namespace).toBe('custom-namespace');

            const resources = calls.filter(call => call[1].metadata?.namespace);
            resources.forEach(resource => {
                expect(resource[1].metadata?.namespace).toBe('custom-namespace');
            });
        });
    });

    describe('Dashboard Configuration', () => {
        test('creates dashboard with authentication', async () => {
            const args = createTestArgs({
                dashboard: {
                    enabled: true,
                    domain: 'traefik.example.com',
                    auth: {
                        enabled: true,
                        username: 'admin',
                        passwordHash: '$2y$05$example'
                    }
                }
            });

            const traefik = new Traefik('test-dashboard', args);
            await (traefik as any).ready;

            const calls = mockResource.mock.mock.calls as MockCall[];

            const authMiddleware = findResourceInCalls(calls, 'Middleware', undefined, 'traefik-auth');
            expect(authMiddleware).toBeDefined();
            expect(authMiddleware![1].spec.basicAuth.users).toContain('admin:$2y$05$example');

            const dashboardRoute = findResourceInCalls(calls, 'IngressRoute', undefined, 'traefik-dashboard');
            expect(dashboardRoute).toBeDefined();
            expect(dashboardRoute![1].spec.routes[0].match).toBe('Host(`traefik.example.com`)');
            expect(dashboardRoute![1].spec.routes[0].middlewares).toContainEqual({
                name: 'traefik-auth',
                namespace: DEFAULT_NAMESPACE
            });
        });

        test('creates dashboard without authentication', async () => {
            const args = createTestArgs({
                dashboard: {
                    enabled: true,
                    domain: 'traefik.example.com'
                }
            });

            const traefik = new Traefik('test-dashboard-no-auth', args);
            await (traefik as any).ready;

            const calls = mockResource.mock.mock.calls as MockCall[];

            const authMiddleware = findResourceInCalls(calls, 'Middleware', undefined, 'traefik-auth');
            expect(authMiddleware).toBeUndefined();

            const dashboardRoute = findResourceInCalls(calls, 'IngressRoute', undefined, 'traefik-dashboard');
            expect(dashboardRoute).toBeDefined();
            expect(dashboardRoute![1].spec.routes[0].middlewares).toHaveLength(0);
        });
    });

    describe('Middleware Configuration', () => {
        test('creates all middleware types when configured', async () => {
            const args = createTestArgs({
                middlewares: {
                    headers: {
                        enabled: true,
                        sslRedirect: true,
                        stsSeconds: 315360000
                    },
                    rateLimit: {
                        enabled: true,
                        average: 100,
                        burst: 50
                    }
                }
            });

            const traefik = new Traefik('test-middlewares', args);
            await (traefik as any).ready;

            const calls = mockResource.mock.mock.calls as MockCall[];

            const headersMiddleware = findResourceInCalls(calls, 'Middleware', undefined, 'secure-headers');
            expect(headersMiddleware).toBeDefined();
            expect(headersMiddleware![1].spec.headers).toMatchObject({
                sslRedirect: true,
                stsSeconds: 315360000,
                stsIncludeSubdomains: true,
                stsPreload: true,
                forceSTSHeader: true
            });

            const rateLimitMiddleware = findResourceInCalls(calls, 'Middleware', undefined, 'rate-limit');
            expect(rateLimitMiddleware).toBeDefined();
            expect(rateLimitMiddleware![1].spec.rateLimit).toEqual({
                average: 100,
                burst: 50
            });
        });

        test('does not create disabled middlewares', async () => {
            const args = createTestArgs({
                middlewares: {
                    headers: {
                        enabled: false
                    },
                    rateLimit: {
                        enabled: false
                    }
                }
            });

            const traefik = new Traefik('test-disabled-middlewares', args);
            await (traefik as any).ready;

            const calls = mockResource.mock.mock.calls as MockCall[];

            const headersMiddleware = findResourceInCalls(calls, 'Middleware', undefined, 'secure-headers');
            expect(headersMiddleware).toBeUndefined();

            const rateLimitMiddleware = findResourceInCalls(calls, 'Middleware', undefined, 'rate-limit');
            expect(rateLimitMiddleware).toBeUndefined();
        });
    });

    describe('TLS Configuration', () => {
        test('creates TLS options with custom configuration', async () => {
            const args = createTestArgs({
                tls: {
                    options: {
                        minVersion: 'VersionTLS12',
                        maxVersion: 'VersionTLS13',
                        cipherSuites: [
                            'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
                            'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256'
                        ]
                    }
                }
            });

            const traefik = new Traefik('test-tls', args);
            await (traefik as any).ready;

            const calls = mockResource.mock.mock.calls as MockCall[];

            const tlsOptions = findResourceInCalls(calls, 'TLSOption', undefined, 'default');
            expect(tlsOptions).toBeDefined();
            expect(tlsOptions![1].spec).toEqual({
                minVersion: 'VersionTLS12',
                maxVersion: 'VersionTLS13',
                cipherSuites: [
                    'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
                    'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256'
                ]
            });
        });
    });

    describe('Resource Configuration', () => {
        test('applies custom resource limits', async () => {
            const args = createTestArgs({
                resources: {
                    requests: {
                        cpu: '200m',
                        memory: '256Mi'
                    },
                    limits: {
                        cpu: '500m',
                        memory: '512Mi'
                    }
                }
            });

            const traefik = new Traefik('test-resources', args);
            await (traefik as any).ready;

            const calls = mockResource.mock.mock.calls as MockCall[];

            const controller = findResourceInCalls(calls, 'TraefikController');
            expect(controller).toBeDefined();
            expect(controller![1].spec.resources).toEqual({
                requests: {
                    cpu: '200m',
                    memory: '256Mi'
                },
                limits: {
                    cpu: '500m',
                    memory: '512Mi'
                }
            });
        });

        test('applies custom replica count', async () => {
            const args = createTestArgs({
                replicas: 3
            });

            const traefik = new Traefik('test-replicas', args);
            await (traefik as any).ready;

            const calls = mockResource.mock.mock.calls as MockCall[];

            const controller = findResourceInCalls(calls, 'TraefikController');
            expect(controller).toBeDefined();
            expect(controller![1].spec.replicas).toBe(3);
        });
    });
});
