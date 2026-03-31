# Code Review Skill

## When to Use
- Reviewing pull requests or changed files for security vulnerabilities and code quality issues.
- Identifying SonarQube rule violations before they reach CI/CD.
- Auditing code for OWASP Top 10 risks in Java, TypeScript, JavaScript, or Python.
- Checking recently changed code for introduced vulnerabilities.

---

## Step 1 — Identify Changed Code

Before reviewing, scope the review to changed files:

```bash
git diff origin/main...HEAD --name-only
git diff origin/main...HEAD -- {specific-file-or-dir}
```

Focus the review on the diff. Do not re-audit unchanged, previously reviewed code unless the user asks.

---

## Step 2 — Security Review (SonarQube / OWASP Top 10)

Work through each category below for the changed files.

### A01 — Broken Access Control
- [ ] Are endpoints protected by authentication and authorization checks?
- [ ] Does any method expose admin functionality without a role guard?
- [ ] Are `@PreAuthorize` / `@Secured` / middleware guards present on sensitive routes?
- [ ] Can a user access or modify another user's data by changing an ID in a request?

**SonarQube rules:** `java:S4834`, `java:S5122`, `typescript:S5122`

### A02 — Cryptographic Failures
- [ ] Is sensitive data (passwords, tokens, PII) encrypted at rest and in transit?
- [ ] Are weak algorithms used? (`MD5`, `SHA1`, `DES`, `RC4` → flag these)
- [ ] Are hardcoded secrets, API keys, or passwords present in source code?
- [ ] Is `SecureRandom` used instead of `Random` for security-sensitive randomness?

**SonarQube rules:** `java:S2068` (hardcoded credentials), `java:S2245` (weak PRNG), `java:S4426` (weak crypto), `java:S5542` (insecure cipher)

```java
// BAD — flag immediately
String secret = "myHardcodedPassword123";
MessageDigest md = MessageDigest.getInstance("MD5");

// GOOD
String secret = System.getenv("APP_SECRET");
MessageDigest md = MessageDigest.getInstance("SHA-256");
```

### A03 — Injection
- [ ] Are all SQL queries parameterized? No string concatenation into queries.
- [ ] Is user input passed to shell commands (`Runtime.exec`, `ProcessBuilder`, `child_process.exec`)?
- [ ] Are LDAP / XPath / NoSQL queries built with unsanitized input?
- [ ] Is `eval()` or `Function()` called with user-controlled strings (JS/TS)?

**SonarQube rules:** `java:S2091` (XPath injection), `java:S2077` (SQL injection), `typescript:S1523` (eval), `java:S3649`

```java
// BAD
String query = "SELECT * FROM users WHERE name = '" + userInput + "'";

// GOOD
PreparedStatement stmt = conn.prepareStatement("SELECT * FROM users WHERE name = ?");
stmt.setString(1, userInput);
```

### A04 — Insecure Design
- [ ] Are there rate limits on authentication or sensitive endpoints?
- [ ] Does the code log sensitive data (passwords, tokens, full credit card numbers)?
- [ ] Are error responses leaking stack traces or internal paths to the client?

**SonarQube rules:** `java:S2629` (log args evaluated eagerly), `java:S4792` (logger config)

### A05 — Security Misconfiguration
- [ ] Are CORS policies overly permissive (`Access-Control-Allow-Origin: *` on authenticated APIs)?
- [ ] Are security headers set (`X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy`)?
- [ ] Are debug endpoints or `actuator` endpoints exposed without a guard?
- [ ] Are default credentials or example configs committed?

**SonarQube rules:** `java:S5122`, `java:S4502` (CSRF disabled)

### A06 — Vulnerable and Outdated Components
- [ ] Check `pom.xml` / `package.json` / `requirements.txt` for known vulnerable dependency versions.
- [ ] Does the diff add a new dependency? Verify it is from a trusted source.

```bash
# Quick CVE check
npm audit --audit-level=high
mvn dependency-check:check
```

### A07 — Identification and Authentication Failures
- [ ] Are JWTs validated for signature, expiry, and issuer?
- [ ] Is `alg: none` rejected in JWT handling?
- [ ] Are session tokens invalidated on logout?
- [ ] Is brute-force protection in place for login endpoints?

**SonarQube rules:** `java:S5659` (JWT not verified), `java:S5660`

### A08 — Software and Data Integrity Failures
- [ ] Are deserialization inputs (JSON, XML, Java `ObjectInputStream`) from untrusted sources?
- [ ] Is XML parsing configured to disable external entity (XXE) expansion?

**SonarQube rules:** `java:S2755` (XXE), `java:S5135` (unsafe deserialization)

```java
// BAD — XXE vulnerable
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();

// GOOD
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
```

### A09 — Security Logging and Monitoring Failures
- [ ] Are authentication events (success/failure) logged?
- [ ] Are logs sanitized to prevent log injection (CRLF in user input echoed to logs)?
- [ ] Is there an audit trail for sensitive operations (e.g., delete user, change password)?

### A10 — Server-Side Request Forgery (SSRF)
- [ ] Is user-controlled input used to construct URLs for outbound HTTP calls?
- [ ] Are allowlists used to restrict which hosts the application can call?

**SonarQube rules:** `java:S5144` (server-side request forgery)

---

## Step 3 — Code Quality (SonarQube Hotspots & Smells)

### Null Safety
- [ ] Are there unchecked `null` dereferences or missing `Optional` handling?
- [ ] Are `NullPointerException` risks introduced by the diff?

**SonarQube rules:** `java:S2259`, `java:S2583`

### Resource Leaks
- [ ] Are `InputStream`, `Connection`, `Statement`, `Session` objects closed in `finally` blocks or try-with-resources?

**SonarQube rules:** `java:S2095`

```java
// BAD
Connection conn = dataSource.getConnection();
conn.createStatement().execute(sql);

// GOOD
try (Connection conn = dataSource.getConnection();
     Statement stmt = conn.createStatement()) {
    stmt.execute(sql);
}
```

### Exception Handling
- [ ] Are exceptions swallowed silently (`catch (Exception e) {}` with no log/rethrow)?
- [ ] Are overly broad exceptions caught when a specific type should be used?
- [ ] Are `Error` types (`OutOfMemoryError`) caught inappropriately?

**SonarQube rules:** `java:S108`, `java:S1166`, `java:S2139`

### Code Complexity
- [ ] Does any method have a cyclomatic complexity > 10? Flag for refactoring.
- [ ] Are methods longer than ~50 lines? Suggest extraction.
- [ ] Are deeply nested conditionals (> 3 levels) present?

**SonarQube rules:** `java:S3776` (cognitive complexity)

### Duplicated Code
- [ ] Is logic copy-pasted from another method or class in the diff? Flag and suggest extraction.

---

## Step 4 — Language-Specific Checks

### Java
- [ ] `String` comparison uses `.equals()`, not `==`.
- [ ] `StringBuilder` used in loops instead of `+` concatenation.
- [ ] Serializable classes define `serialVersionUID`.
- [ ] `@Transactional` is not applied to private methods (Spring proxy limitation).

**SonarQube rules:** `java:S1698`, `java:S1643`, `java:S2057`

### TypeScript / JavaScript
- [ ] `===` used instead of `==` for equality checks.
- [ ] `any` type avoided in TypeScript; use proper types.
- [ ] `console.log` not left in production code paths.
- [ ] Promises are properly `await`ed or have `.catch()` handlers.

**SonarQube rules:** `typescript:S1143`, `typescript:S3800`, `typescript:S4327`

### SQL / JPA
- [ ] Native queries use `@Param` binding, not string formatting.
- [ ] `LIKE` queries with user input escape wildcard characters (`%`, `_`).

---

## Step 5 — Output Format

Summarize findings grouped by severity:

### 🔴 Critical / Blocker (must fix before merge)
- List security vulnerabilities (injection, hardcoded secrets, broken auth).

### 🟠 Major (should fix)
- Resource leaks, missing error handling, weak crypto.

### 🟡 Minor / Info (consider fixing)
- Code smells, complexity, style issues.

For each finding, provide:
1. **File + line** (from the diff)
2. **Rule** (e.g., `java:S2068`)
3. **Issue description**
4. **Suggested fix** with a short code snippet when helpful
