import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { NextRequest } from 'next/server'
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3"

function sanitizeBucketNameFromUserId(userId: string): string {
  const lower = userId.toLowerCase()
  let name = lower.replace(/[^a-z0-9-]/g, '-')
  name = name.replace(/^-+/, '').replace(/-+$/, '')
  if (name.length < 3) name = name.padEnd(3, '0')
  if (name.length > 63) name = name.slice(0, 63)
  if (/^(\d+\.){3}\d+$/.test(name)) name = `u-${name}`
  if (name.startsWith('xn--')) name = `u-${name}`
  if (name.endsWith('-')) name = name.replace(/-+$/, '')
  if (name.startsWith('-')) name = name.replace(/^-+/, '')
  if (!name) name = 'user-bucket'
  return name
}

const awsRegion = process.env.AWS_REGION || 'us-east-1'
const s3 = new S3Client({ region: awsRegion })

export async function POST(req: NextRequest) {
  try {
    const evt = await verifyWebhook(req)

    if (evt.type === 'user.created') {
        const userId: string = (evt as any)?.data?.id
        if (!userId) {
          console.warn('Clerk webhook missing user id on user.created')
        } else {
          const bucketName = sanitizeBucketNameFromUserId(userId)
          try {
            const createParams: any = { Bucket: bucketName }
            if (awsRegion !== 'us-east-1') {
              createParams.CreateBucketConfiguration = { LocationConstraint: awsRegion }
            }
            await s3.send(new CreateBucketCommand(createParams))
            console.log(`Created S3 bucket: ${bucketName}`)
          } catch (error: any) {
            const code = error?.name || error?.Code || error?.code
            if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
              console.log(`Bucket already exists or owned: ${bucketName}`)
            } else {
              console.error('Failed to create S3 bucket for user:', userId, error)
            }
          }
        }
    }

    return new Response('Webhook received', { status: 200 })
  } catch (err) {
    console.error('Error verifying webhook:', err)
    return new Response('Error verifying webhook', { status: 400 })
  }
}