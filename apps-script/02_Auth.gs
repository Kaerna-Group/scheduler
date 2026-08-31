function bytesToHex_(bytes) {
  return bytes.map(function (byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return normalized.toString(16).padStart(2, '0');
  }).join('');
}

function hashEditToken_(token) {
  return bytesToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(token),
    Utilities.Charset.UTF_8,
  ));
}

function generateEditToken_() {
  const seed = Utilities.getUuid() + Utilities.getUuid() + String(new Date().getTime());
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    seed,
    Utilities.Charset.UTF_8,
  )).replace(/=+$/, '');
}

function authenticateEditToken_(database, token) {
  if (!token || String(token).length < 24) {
    throw schedulerError_('UNAUTHORIZED', 'A valid edit token is required.');
  }
  const hash = hashEditToken_(token);
  const user = database.Users.find(function (item) {
    return isActive_(item.active) && item.edit_token_hash === hash;
  });
  if (!user) throw schedulerError_('UNAUTHORIZED', 'Edit token is invalid or revoked.');
  return user;
}

function requireRole_(user, allowedRoles) {
  if (allowedRoles.indexOf(user.role) === -1) {
    throw schedulerError_('FORBIDDEN', 'This operation requires one of these roles: ' + allowedRoles.join(', ') + '.');
  }
}

function resolveWritableUser_(database, actor, targetSlug) {
  const slug = String(targetSlug || '').trim();
  if (!slug) throw schedulerError_('VALIDATION_ERROR', 'userSlug is required for write operations.');
  if (actor.slug === slug) return actor;
  if (actor.role !== 'admin') throw schedulerError_('FORBIDDEN', 'A user may edit only their own enrollments.');
  const target = database.Users.find(function (row) { return row.slug === slug && isActive_(row.active); });
  if (!target) throw schedulerError_('USER_NOT_FOUND', 'Unknown or inactive target user: ' + slug);
  return target;
}

function publicUser_(user) {
  return {
    id: user.user_id,
    slug: user.slug,
    displayName: user.display_name,
    role: user.role,
  };
}
