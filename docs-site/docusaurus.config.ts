import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Homelab Documentation', // Updated title
  tagline: 'Comprehensive guide to the homelab environment', // Updated tagline
  favicon: 'img/favicon.ico', // Keep default or replace later

  // Set the production url of your site here
  url: 'https://sprime01.github.io', // Replace with your actual URL
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/homelab/', // Assuming deployment to GitHub Pages under /homelab/

  // GitHub pages deployment config.
  organizationName: 'sprime01', // Replace with your GitHub org/user name.
  projectName: 'homelab', // Replace with your repo name.

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // Update the editUrl to point to your specific repo and docs folder
          editUrl:
            'https://github.com/sprime01/homelab/tree/main/homelab-infra/docs-site/', // Updated edit URL
        },
        blog: false, // Disable blog if not needed for this documentation site
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.jpg', // Keep default or replace later
    navbar: {
      title: 'Homelab Docs', // Updated navbar title
      logo: {
        alt: 'Homelab Logo', // Updated alt text
        src: 'img/logo.svg', // Keep default or replace later
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar', // Use a more generic ID, will define in sidebars.ts
          position: 'left',
          label: 'Documentation', // Updated label
        },
        {
          href: 'https://github.com/sprime01/homelab', // Link to the main repo
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Architecture',
              to: '/docs/architecture/overview', // Link to a future page
            },
            {
              label: 'Components',
              to: '/docs/components/introduction', // Link to a future page
            },
            {
                label: 'Operations',
                to: '/docs/operations/procedures', // Link to a future page
            },
          ],
        },
        {
          title: 'Guides',
          items: [
            {
              label: 'Troubleshooting',
              to: '/docs/troubleshooting/common-issues', // Link to a future page
            },
            {
              label: 'Runbooks',
              to: '/docs/runbooks/common-tasks', // Link to a future page
            },
          ],
        },
        {
          title: 'More',
          items: [
             {
              label: 'API Docs',
              to: '/docs/api/introduction', // Link to a future page
            },
            {
              label: 'GitHub',
              href: 'https://github.com/sprime01/homelab', // Link to the main repo
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Homelab Project. Built with Docusaurus.`, // Updated copyright
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
    algolia: { // Or use local search plugin if preferred
        appId: 'YOUR_APP_ID', // Replace with your Algolia App ID
        apiKey: 'YOUR_SEARCH_API_KEY', // Replace with your Algolia Search API Key
        indexName: 'YOUR_INDEX_NAME', // Replace with your Algolia Index Name
        contextualSearch: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
