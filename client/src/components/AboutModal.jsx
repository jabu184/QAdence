import React from 'react';
import { X, ShieldCheck, User, Sparkles } from 'lucide-react';
import { APP_VERSION, APP_AUTHOR, APP_TITLE, APP_TAGLINE } from '../version';

export default function AboutModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 100 }}>
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '460px',
          padding: '2rem 1.75rem',
          position: 'relative',
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          background: '#ffffff',
          textAlign: 'center'
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'transparent',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '6px'
          }}
          title="Close"
        >
          <X size={20} />
        </button>

        {/* Logo */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
          <img
            src="/logo.jpg"
            alt="QAdence Logo"
            style={{
              height: '96px',
              width: 'auto',
              objectFit: 'contain',
              borderRadius: '8px'
            }}
          />
        </div>

        {/* Title & Version Badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '0.35rem' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
            {APP_TITLE}
          </h2>
          <span style={{
            fontSize: '0.75rem',
            fontWeight: '700',
            padding: '2px 8px',
            borderRadius: '999px',
            background: '#eff6ff',
            color: '#2563eb',
            border: '1px solid #bfdbfe'
          }}>
            {APP_VERSION}
          </span>
        </div>

        <p style={{ fontSize: '0.82rem', color: '#64748b', margin: '0 0 1.5rem 0', lineHeight: 1.4 }}>
          {APP_TAGLINE}
        </p>

        {/* Details Box */}
        <div style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '1.25rem',
          textAlign: 'left',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.85rem',
          marginBottom: '1.5rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <User size={14} color="#2563eb" /> Author
            </span>
            <span style={{ fontSize: '0.88rem', fontWeight: '700', color: '#0f172a' }}>
              {APP_AUTHOR}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Sparkles size={14} color="#2563eb" /> Version
            </span>
            <span style={{ fontSize: '0.88rem', fontWeight: '700', color: '#0f172a' }}>
              {APP_VERSION}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ShieldCheck size={14} color="#059669" /> QATrack+ Compatibility
            </span>
            <span style={{ fontSize: '0.82rem', fontWeight: '600', color: '#0f172a' }}>
              v3.1+ REST API
            </span>
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '0.65rem 1rem',
            borderRadius: '8px',
            background: '#2563eb',
            color: '#ffffff',
            border: 'none',
            fontSize: '0.88rem',
            fontWeight: '600',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)'
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
