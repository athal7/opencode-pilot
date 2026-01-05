/**
 * Tests for github-app.js - GitHub App authentication
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import {
  createAppJwt,
  isGitHubAppConfigured,
  getGitHubAppIdentity,
  clearTokenCache,
} from "../../service/github-app.js";

describe("GitHub App authentication", () => {
  beforeEach(() => {
    clearTokenCache();
  });

  describe("isGitHubAppConfigured", () => {
    test("returns false for null config", () => {
      assert.strictEqual(isGitHubAppConfigured(null), false);
    });

    test("returns false for empty config", () => {
      assert.strictEqual(isGitHubAppConfigured({}), false);
    });

    test("returns false when missing app_id", () => {
      assert.strictEqual(
        isGitHubAppConfigured({
          github_app_installation_id: "123",
          github_app_private_key: "key",
        }),
        false
      );
    });

    test("returns false when missing installation_id", () => {
      assert.strictEqual(
        isGitHubAppConfigured({
          github_app_id: "123",
          github_app_private_key: "key",
        }),
        false
      );
    });

    test("returns false when missing private_key and private_key_path", () => {
      assert.strictEqual(
        isGitHubAppConfigured({
          github_app_id: "123",
          github_app_installation_id: "456",
        }),
        false
      );
    });

    test("returns true with inline private_key", () => {
      assert.strictEqual(
        isGitHubAppConfigured({
          github_app_id: "123",
          github_app_installation_id: "456",
          github_app_private_key: "-----BEGIN RSA PRIVATE KEY-----",
        }),
        true
      );
    });

    test("returns true with private_key_path", () => {
      assert.strictEqual(
        isGitHubAppConfigured({
          github_app_id: "123",
          github_app_installation_id: "456",
          github_app_private_key_path: "~/.config/my-app.pem",
        }),
        true
      );
    });
  });

  describe("createAppJwt", () => {
    // Use a test RSA key (NOT a real key - for testing only)
    const TEST_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy0AHB7MfszVvLcpw0mUn0q
H6urJovU5RLNyxHNT6sYsKqkDVjT3V6GaYuHfv3HLTYhHNkrQRKQj9I+HgXH6jVP
6vh0cBJk+MbWKS3xTKNmGrJ0S6X7AXYH4P1o3B6mvCVBVB5YYJPlGxBn/GLOQ1RP
i+0Y0S5h/cW4sXmzFW0GCPqiAPZT8WQEb4OqJWG1f8Z3jDO6FiUG6Q8RQXfjcYfA
VH1I4xh1sLwmJhP4lXj8dB3OjXq9NQTO9T8JY0KmkZj1R6UJw8HLEp7e1pYYXIrr
gXxmXCao2zMpfBXi0d7bT6Cq5Q9OAQX0ZHVXnwIDAQABAoIBAFSvPM2JZqHxcvBV
L9Dc4bRiZz0RhXmUQ6v0F4wYx8jA9IxQb/b1PS5z7L6HxNmpXYGsVjVWjpN4bPqN
kD5D7ERbGvGQ9XEkGR2USvNJi5Uiz3myqQJ6cSsFwjHQoE9F9EwCZFfB9GoGISD2
njMQhPw9aN3isb/w/yy4h5FGgMdCVXKQkXU9FRvXHKWt6yLmJJrmD9CYhx/nnYLH
1fy7V9HXj0NNxWF/uy1EFiTsXi6v7YFi9qWmMhnGGGSPlFu4r7kOdSl9FJnfisGn
S6RkqJCsP7dGvF2F9k0+q5iBl6X5q7LVs0nDY6k7zzFj5kDv3FHU7YK9mVDLb/5T
g8uRlFECgYEA72C0/CYqjZfb/6l7p5tkVzfVLZgK8e6zU3ryFanQKHHp7FgUb/qx
C3JNmLQl0SpU5I0H7dhjvr1kDfZkFcl0T9tOv0GloYHxsi0z9SteKdUyZK0iS5Wv
7rsjYzf3FEoZJI+cZbvXDdA/C5tBkNfTVgp0gMQ7tI/cMNBt6fVLXQ0CgYEA37vn
LwbJAC5ukDKJ8hh/DSfNLvxOfpi3o7L0b5kMH7lGZPYqlMrbmFJpU6gAOgKfHBJL
jLjTmFhR64Dk4D1isJuEbwQil5q1ETPAU5fFEn6FnD2e7L1S/hKq08sIv3hjS3qW
XvgqLbKJj5F7jFHilMJVQ5p+v2c5GqF+FX8FkIsCgYBcNdQPLnmBDZJt5qFG9cpz
Y7vsQBjkKqM9JhLird8dSHWlfaZGPU3HNfJkpLTErHy4dPLzj8x0kLkWb6nsqvcU
9LGbfpNgJOvCZLVVH3CrIsYp/mLbKj9A3KqgqK9ue0XtQMLgPOKpVB7DPohs2zqf
Gq+8HY6CpPr1OT7SLJ6Y7QKBgBtqMlwPniLfX7W3xJ7lPGD0bCr0QYjOMzIFLFpv
bGVn5lFVL1VQGq0f5OPAkVdGVLGqTcFLBsbLohPVY9hJlJk8GiMSfvb5z+lT0bNU
vJVcj1tQ5U0P1mcgPSjYYQPdJbKJO6/yTQ5lqpMo+lMPcZ9gT6ohxYZr7M9dGP0Q
cJMDAoGBAKP0ROeJQzqsL0P0sIMdF4PETM+IVHPB1kE7fB5gNv+xLRJOdwpRO0KN
yJwfkDx9DNNm6HhAVCKqdmLiPb0P0GyhAP9izwoc1pQlvhzU5sxF4+PE0VqF6X6F
K2Y76VBAH28iCeZkAvMHYAF0OqOh3JFYQWC3pHmKD0mP/r7gAWaQ
-----END RSA PRIVATE KEY-----`;

    test("creates a valid JWT structure", () => {
      const jwt = createAppJwt("12345", TEST_PRIVATE_KEY);

      // JWT should have 3 parts
      const parts = jwt.split(".");
      assert.strictEqual(parts.length, 3);

      // Decode header
      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
      assert.strictEqual(header.alg, "RS256");
      assert.strictEqual(header.typ, "JWT");

      // Decode payload
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      assert.strictEqual(payload.iss, "12345");
      assert.ok(payload.iat);
      assert.ok(payload.exp);
      assert.ok(payload.exp > payload.iat);
    });
  });

  describe("getGitHubAppIdentity", () => {
    test("returns default slug when not specified", () => {
      const identity = getGitHubAppIdentity({
        github_app_id: "12345",
      });

      assert.strictEqual(identity.name, "opencode-pilot[bot]");
      assert.strictEqual(
        identity.email,
        "12345+opencode-pilot[bot]@users.noreply.github.com"
      );
    });

    test("uses custom slug when specified", () => {
      const identity = getGitHubAppIdentity({
        github_app_id: "67890",
        github_app_slug: "my-custom-app",
      });

      assert.strictEqual(identity.name, "my-custom-app[bot]");
      assert.strictEqual(
        identity.email,
        "67890+my-custom-app[bot]@users.noreply.github.com"
      );
    });
  });
});
