import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/**
 * Define the structure of the documentation sidebar.
 */
const sidebars: SidebarsConfig = {
  // Define the main sidebar used by the documentation plugin
  docsSidebar: [
    {
      type: 'category',
      label: 'Introduction',
      items: ['intro'], // Link to the default intro page
    },
    {
      type: 'category',
      label: 'Architecture Overview',
      link: {
        type: 'generated-index',
        title: 'Architecture Overview',
        description: 'High-level design and structure of the homelab.',
        slug: '/category/architecture',
      },
      items: [{type: 'autogenerated', dirName: 'architecture'}],
    },
    {
      type: 'category',
      label: 'Component Documentation',
      link: {
        type: 'generated-index',
        title: 'Component Documentation',
        description: 'Details about individual components and services.',
        slug: '/category/components',
      },
      items: [{type: 'autogenerated', dirName: 'components'}],
    },
    {
      type: 'category',
      label: 'Operational Procedures',
      link: {
        type: 'generated-index',
        title: 'Operational Procedures',
        description: 'Standard operating procedures for managing the homelab.',
        slug: '/category/operations',
      },
      items: [{type: 'autogenerated', dirName: 'operations'}],
    },
    {
      type: 'category',
      label: 'Troubleshooting Guides',
      link: {
        type: 'generated-index',
        title: 'Troubleshooting Guides',
        description: 'Guides for diagnosing and resolving common issues.',
        slug: '/category/troubleshooting',
      },
      items: [{type: 'autogenerated', dirName: 'troubleshooting'}],
    },
    {
      type: 'category',
      label: 'API Documentation',
      link: {
        type: 'generated-index',
        title: 'API Documentation',
        description: 'Documentation for internal APIs.',
        slug: '/category/api',
      },
      items: [{type: 'autogenerated', dirName: 'api'}],
    },
    {
      type: 'category',
      label: 'Runbooks',
      link: {
        type: 'generated-index',
        title: 'Runbooks',
        description: 'Step-by-step guides for common tasks.',
        slug: '/category/runbooks',
      },
      items: [{type: 'autogenerated', dirName: 'runbooks'}],
    },
  ],
};

export default sidebars;
