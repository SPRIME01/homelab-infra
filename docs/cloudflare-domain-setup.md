# Cloudflare Domain Setup for Homelab

This guide will walk you through setting up a domain on Cloudflare for your homelab environment, providing secure external access to your services.

## Table of Contents

- [1. Domain Registration or Transfer](#1-domain-registration-or-transfer)
- [2. DNS Configuration](#2-dns-configuration)
- [3. SSL/TLS Encryption Setup](#3-ssltls-encryption-setup)
- [4. Security Settings Configuration](#4-security-settings-configuration)
- [5. Page Rules for Caching and Redirects](#5-page-rules-for-caching-and-redirects)
- [6. Best Practices Summary](#6-best-practices-summary)

## 1. Domain Registration or Transfer

### Registering a New Domain with Cloudflare

1. **Create a Cloudflare account**:
   - Go to [https://dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
   - Complete the registration form

2. **Register a domain**:
   - In your Cloudflare dashboard, click on "Domains" > "Register"
   - Search for your desired domain name
   - Complete the purchase process (Cloudflare offers domains at wholesale prices with free privacy protection)

### Transferring an Existing Domain to Cloudflare

1. **Prepare your current domain**:
   - Unlock the domain at your current registrar
   - Obtain the authorization/transfer code
   - Ensure your WHOIS information is current
   - Disable WHOIS privacy temporarily (if enabled)

2. **Initiate the transfer**:
   - In your Cloudflare dashboard, click on "Domains" > "Transfer"
   - Enter your domain name
   - Follow the prompts and enter your authorization code
   - Complete the payment process (1 year extension included in transfer)

3. **Approve the transfer**:
   - Watch for an approval email from Cloudflare
   - Complete the transfer process following the instructions

### Using Cloudflare DNS Only (Keep Existing Registrar)

1. **Add site to Cloudflare**:
   - From your dashboard, click "Add a Site"
   - Enter your domain name and select the Free plan (or another plan if needed)
   - Allow Cloudflare to scan your existing DNS records

2. **Update nameservers at your registrar**:
   - Note the Cloudflare nameservers provided (usually ns1.cloudflare.com and ns2.cloudflare.com)
   - Go to your domain registrar's dashboard
   - Replace the current nameservers with Cloudflare's nameservers
   - Save changes (propagation can take 24-48 hours)

## 2. DNS Configuration

### Basic DNS Setup

1. **Access DNS settings**:
   - Log in to your Cloudflare dashboard
   - Select your domain
   - Click on the "DNS" tab

2. **Configure A records**:
   - For your main domain (e.g., example.com), click "Add record"
   - Select "A" as the record type
   - Set the name to "@" (represents the root domain)
   - Enter your homelab's public IP address or the Cloudflare Tunnel endpoint
   - Toggle the proxy status to "Proxied" (orange cloud)

3. **Configure CNAME records for subdomains**:
   - Click "Add record"
   - Select "CNAME" as the record type
   - Enter the subdomain name (e.g., "media" for media.example.com)
   - For the target, enter your root domain or specific endpoint
   - Toggle the proxy status to "Proxied" for subdomains accessible publicly

4. **Set up MX records (if using email)**:
   - Click "Add record"
   - Select "MX" as the record type
   - Enter "@" for the name
   - Add the mail server address provided by your email provider
   - Set the priority value (lower numbers = higher priority)
   - Leave proxy status "DNS only" (gray cloud)

5. **Configure TXT records**:
   - Add SPF, DKIM, and DMARC records if you're using email
   - Add verification records for third-party services if needed

### Advanced DNS Configuration

1. **Create DNS records for internal services**:
   - Add records for each homelab service (e.g., homeassistant.example.com)
   - Decide which should be proxied (public services) vs. DNS only (private)

2. **Set appropriate TTL values**:
   - For stable services, use longer TTLs (e.g., 3600-86400 seconds)
   - For services that might change IPs frequently, use shorter TTLs

3. **Configure CAA records for enhanced security**:
   - Click "Add record" and select "CAA"
   - Add records to specify which Certificate Authorities can issue certificates for your domain

## 3. SSL/TLS Encryption Setup

1. **Access SSL/TLS settings**:
   - From your domain dashboard, click "SSL/TLS"

2. **Choose encryption mode**:
   - Go to the "Overview" tab
   - Select "Full" or "Full (strict)" mode
     - **Full**: Cloudflare validates the certificate but doesn't verify it was issued by a trusted CA
     - **Full (strict)** [Recommended]: Cloudflare validates the certificate must be trusted and not expired

3. **Enable SSL/TLS for all subdomains**:
   - Go to "Edge Certificates"
   - Ensure "Always Use HTTPS" is enabled
   - Enable "Automatic HTTPS Rewrites" to fix mixed content

4. **Configure cipher settings**:
   - Go to "Edge Certificates" > "Cipher Suites"
   - Select "Modern" for better security or "Compatible" if you need to support older clients

5. **Configure TLS version**:
   - Set minimum TLS version to 1.2 (recommended) or 1.3 (most secure)
   - Disable older TLS versions for better security

6. **Enable Certificate Transparency Monitoring**:
   - Under "Edge Certificates", enable CT monitoring to be alerted if certificates are issued for your domain

7. **Origin Server Configuration (if using Full Strict)**:
   - Create or upload an Origin Certificate for your homelab server
   - Install the certificate on your web server or reverse proxy

## 4. Security Settings Configuration

### Web Application Firewall (WAF)

1. **Enable WAF**:
   - Navigate to "Security" > "WAF"
   - Deploy managed rulesets based on your needs

2. **Configure WAF settings**:
   - Enable "Managed Rules" to protect against common vulnerabilities
   - Review and adjust sensitivity levels for different rule categories
   - Add custom rules for specific requirements

3. **OWASP Core Ruleset**:
   - Enable OWASP core ruleset
   - Set the paranoia level based on your security needs
   - Monitor for false positives and adjust as needed

### Bot Management

1. **Access Bot Management**:
   - Navigate to "Security" > "Bots"
   - Enable Bot Fight Mode (available on Free plan)
   - For advanced protection, consider upgrading to Super Bot Fight Mode or Bot Management (paid features)

2. **Configure Bot Management settings**:
   - Define actions for different bot categories (verified, likely automated, etc.)
   - Create custom rules for specific bot behaviors
   - Configure traffic thresholds for challenge pages

### Additional Security Settings

1. **Enable Rate Limiting**:
   - Navigate to "Security" > "Rate Limiting" (may require paid plan)
   - Create rules to limit request rates for specific endpoints
   - Set appropriate thresholds and action types

2. **Configure Security Headers**:
   - Navigate to "Rules" > "Transform Rules"
   - Add security headers like Content-Security-Policy, X-XSS-Protection, etc.

3. **Enable Email Address Obfuscation**:
   - Navigate to "Security" > "Settings"
   - Enable "Email Address Obfuscation" to protect against email harvesters

4. **Configure Hotlink Protection**:
   - Navigate to "Security" > "Settings"
   - Enable "Hotlink Protection" to prevent others from embedding your content

5. **Set up Authenticated Origin Pulls (optional, advanced)**:
   - Requires TLS client certificate authentication between Cloudflare and your origin

## 5. Page Rules for Caching and Redirects

### Creating Basic Page Rules

1. **Access Page Rules**:
   - Navigate to "Rules" > "Page Rules"
   - Click "Create Page Rule"

2. **Configure Caching Rules**:
   - Enter the URL pattern (e.g., `example.com/static/*`)
   - Set "Cache Level" to "Cache Everything"
   - Set "Edge Cache TTL" to an appropriate value (e.g., 2 hours, 1 day)

3. **Create Redirect Rules**:
   - Enter the source URL pattern
   - Select "URL Forwarding" or "301/302 Redirect"
   - Specify the destination URL

### Advanced Page Rules

1. **Bypass Cache for Specific URLs**:
   - Create a rule for admin areas or dynamic content
   - Set "Cache Level" to "Bypass"

2. **Apply WAF to Specific Paths**:
   - Create a rule targeting sensitive paths
   - Enable "Security Level" and set to "High" or "I'm Under Attack"

3. **Force HTTPS for All Traffic**:
   - Create a rule with the pattern `*example.com/*`
   - Select "Always Use HTTPS"

4. **Optimize Content Delivery**:
   - Enable "Rocket Loader" for JavaScript-heavy pages
   - Enable "Auto Minify" for HTML, CSS, and JavaScript
   - Enable "Browser Cache TTL" and set appropriate values

5. **Order Your Rules Correctly**:
   - Page Rules are processed in order, with only the first matching rule applied
   - Drag and drop rules to prioritize specific rules over general ones

## 6. Best Practices Summary

### Security Best Practices

1. **Use "Full (Strict)" SSL mode** whenever possible
2. **Enable WAF and configure managed rules**
3. **Implement proper rate limiting** for login pages and APIs
4. **Use strong security headers** (CSP, HSTS, X-XSS-Protection, etc.)
5. **Enable Two-Factor Authentication** for your Cloudflare account
6. **Regularly audit DNS records** and remove unused entries
7. **Implement proper CAA records** to restrict which CAs can issue certificates
8. **Use Authenticated Origin Pulls** for critical applications
9. **Enable DNSSEC** if supported by your registrar

### Performance Best Practices

1. **Use Cloudflare's CDN** (proxied records) for static content
2. **Configure appropriate cache TTLs** based on content type
3. **Enable Auto Minify** for HTML, CSS, and JavaScript
4. **Use Brotli compression** when available
5. **Implement proper cache control headers** on your origin server
6. **Use Workers for edge computing** needs (requires Workers subscription)
7. **Optimize images** using Cloudflare's Polish feature (on paid plans)
8. **Configure proper Browser Cache TTL** to reduce repeated requests

### Monitoring and Maintenance

1. **Regularly review Analytics** in the Cloudflare dashboard
2. **Set up notifications** for security events and performance issues
3. **Use Cloudflare Workers** to monitor application health
4. **Periodically test your security settings** with tools like SSL Labs
5. **Keep your firewall rules updated** as your application evolves

## Conclusion

With your domain properly configured on Cloudflare, you now have a secure and performant gateway to your homelab services. The combination of Cloudflare's global CDN, security features, and optimization tools will help protect your services while making them more responsive to users.

Remember to regularly review your settings and keep your configurations updated as both your homelab and Cloudflare's offerings evolve.

For more information and advanced configurations, refer to the [official Cloudflare documentation](https://developers.cloudflare.com/fundamentals/).
