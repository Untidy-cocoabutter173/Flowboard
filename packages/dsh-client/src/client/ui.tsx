import type { ComponentProps, ReactNode } from 'react'
import { Badge, Button as AntButton, Input as AntInput, type ButtonProps as AntButtonProps } from 'antd'
import { DeleteOutlined, EditOutlined, PlayCircleOutlined, PlusOutlined, SearchOutlined, StopOutlined, UserOutlined } from '@ant-design/icons'

type LegacyVariant = 'primary' | 'outline' | 'ghost' | 'toolbar'
type LegacyButtonProps = Omit<AntButtonProps, 'type' | 'size' | 'htmlType' | 'variant' | 'className'> & {
  variant?: LegacyVariant
  size?: 'sm' | 'md' | 'lg'
  type?: 'button' | 'submit' | 'reset'
  className?: string | undefined
}

export function Button({ variant = 'outline', size = 'md', type = 'button', className, ...props }: LegacyButtonProps) {
  const antType = variant === 'primary' ? 'primary' : variant === 'ghost' || variant === 'toolbar' ? 'text' : 'default'
  return (
    <AntButton
      {...props}
      {...(className === undefined ? {} : { className })}
      type={antType}
      size={size === 'sm' ? 'small' : size === 'lg' ? 'large' : 'middle'}
      htmlType={type}
    />
  )
}

type InputProps = ComponentProps<typeof AntInput> & { icon?: ReactNode }

export function Input({ icon, ...props }: InputProps) {
  return <AntInput {...props} prefix={icon ?? props.prefix} />
}

export const TextArea = AntInput.TextArea

const icon = (Component: typeof EditOutlined) => function FrameworkIcon({ size = 16, className }: { size?: number; className?: string }) {
  return <Component className={className} style={{ fontSize: size }} />
}

export const IconEditOutline16 = icon(EditOutlined)
export const IconPlusOutline16 = icon(PlusOutlined)
export const IconSearchOutline16 = icon(SearchOutlined)
export const IconTrashOutline16 = icon(DeleteOutlined)
export const IconUserOutline16 = icon(UserOutlined)
export const IconPlayOutline16 = icon(PlayCircleOutlined)
export const IconStopFill16 = icon(StopOutlined)

export function StateDot({ state }: { state: 'done' | 'error' | 'pending' | 'running' | 'warning' | 'ongoing' }) {
  return <Badge status={state === 'done' ? 'success' : state === 'error' ? 'error' : state === 'warning' ? 'warning' : 'processing'} />
}
