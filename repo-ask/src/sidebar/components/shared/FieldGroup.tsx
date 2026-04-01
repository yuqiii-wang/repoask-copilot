import React from 'react';

export interface FieldGroupProps {

    id: string;
    label: string;
    children: React.ReactNode;
    actions?: React.ReactNode;
    collapsed: boolean;
    onToggle: () => void;
}

export default function FieldGroup({ id, label, children, actions, collapsed, onToggle }: FieldGroupProps) {
    return (
        <div className="metadata-field-group" id={`field-group-${id}`}>
            <div className="metadata-field-header">
                <label className="metadata-label">{label}</label>
                <div className="metadata-field-actions">
                    {actions}
                    <button className="metadata-section-btn" type="button" title={collapsed ? 'Expand' : 'Collapse'} onClick={onToggle}>
                        {collapsed ? '▶' : '▼'}
                    </button>
                </div>
            </div>
            {!collapsed && children}
        </div>
    );
}
